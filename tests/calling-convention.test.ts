import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift, type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import {
  shouldPassIndirectly,
  makeSwiftNativeFunction,
} from "../src/runtime/calling-convention.js";
import { readString } from "../src/abi/string.js";

// Exposed by the GumJS runtime, not declared in @types/frida-gum.
declare function gc(): void;

function fixtureFn(skip: Skip, swiftName: string): NativePointer {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

function intValue(v: number): NativePointer {
  const p = Memory.alloc(8);
  p.writeU64(v);
  return p;
}

describe("shouldPassIndirectly", () => {
  test("scalars and register-sized aggregates pass directly", ({ skip }) => {
    requireSwift(skip);
    expect(shouldPassIndirectly(Swift.metadataFor("Swift.Int")!)).toBe(false);
    expect(shouldPassIndirectly(Swift.metadataFor("Swift.Bool")!)).toBe(false);
  });

  test("four-word struct is at the loadable boundary, five-word is indirect", ({ skip }) => {
    loadFixture(skip);
    expect(shouldPassIndirectly(Swift.metadataFor("fixture.LoadableStruct")!)).toBe(false);
    expect(shouldPassIndirectly(Swift.metadataFor("fixture.BigStruct")!)).toBe(true);
  });
});

describe("makeSwiftNativeFunction", () => {
  test("scalar arguments and a scalar return", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn(skip, "fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("direct (multi-register) struct return", ({ skip }) => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const make = makeSwiftNativeFunction(fixtureFn(skip, "fixture.makeLoadableStruct"), Loadable, []);
    const r = make()!;
    for (let i = 0; i < 4; i++) {
      expect(r.add(i * 8).readU64().toNumber()).toBe(i + 1);
    }
  });

  test("indirect (x8) struct return", ({ skip }) => {
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const make = makeSwiftNativeFunction(fixtureFn(skip, "fixture.makeBigStruct"), Big, []);
    const r = make()!;
    for (let i = 0; i < 5; i++) {
      expect(r.add(i * 8).readU64().toNumber()).toBe(i + 1);
    }
  });

  test("direct (register-exploded) struct argument", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const sum = makeSwiftNativeFunction(fixtureFn(skip, "fixture.sumLoadable"), Int, [Loadable]);
    const arg = Memory.alloc(Loadable.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(10);
  });

  test("indirect struct argument", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const sum = makeSwiftNativeFunction(fixtureFn(skip, "fixture.sumBig"), Int, [Big]);
    const arg = Memory.alloc(Big.typeLayout.stride);
    for (let i = 0; i < 5; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(15);
  });

  test("decodes a non-POD (String) return value", ({ skip }) => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const make = makeSwiftNativeFunction(fixtureFn(skip, "fixture.makeString"), String_, []);
    expect(readString(make()!)).toBe("New Cairo");
  });

  test("survives garbage collection between creation and call", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn(skip, "fixture.addInts"), Int, [Int, Int]);
    if (typeof gc === "function") {
      gc();
      gc();
    }
    expect(add(intValue(1), intValue(2))!.readU64().toNumber()).toBe(3);
  });

  test("successive results do not alias", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn(skip, "fixture.addInts"), Int, [Int, Int]);
    const r1 = add(intValue(1), intValue(2))!;
    const r2 = add(intValue(10), intValue(20))!;
    expect(r1.equals(r2)).toBe(false);
    expect(r1.readU64().toNumber()).toBe(3);
    expect(r2.readU64().toNumber()).toBe(30);
  });
});
