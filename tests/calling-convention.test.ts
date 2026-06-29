import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import {
  shouldPassIndirectly,
  makeSwiftNativeFunction,
  SwiftThrownError,
} from "../src/runtime/calling-convention.js";
import { readString } from "../src/abi/string.js";
import { findProtocol, conformsToProtocol } from "../src/abi/protocol-conformance.js";

// Exposed by the GumJS runtime, not declared in @types/frida-gum.
declare function gc(): void;

function fixtureFn(swiftName: string): NativePointer {
  const mod = loadFixture();
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
  test("scalars and register-sized aggregates pass directly", () => {
    requireSwift();
    expect(shouldPassIndirectly(Swift.metadataFor("Swift.Int")!)).toBe(false);
    expect(shouldPassIndirectly(Swift.metadataFor("Swift.Bool")!)).toBe(false);
  });

  test("four-word struct is at the loadable boundary, five-word is indirect", () => {
    loadFixture();
    expect(shouldPassIndirectly(Swift.metadataFor("fixture.LoadableStruct")!)).toBe(false);
    expect(shouldPassIndirectly(Swift.metadataFor("fixture.BigStruct")!)).toBe(true);
  });
});

describe("makeSwiftNativeFunction", () => {
  test("scalar arguments and a scalar return", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn("fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("direct (multi-register) struct return", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const make = makeSwiftNativeFunction(fixtureFn("fixture.makeLoadableStruct"), Loadable, []);
    const r = make()!;
    for (let i = 0; i < 4; i++) {
      expect(r.add(i * 8).readU64().toNumber()).toBe(i + 1);
    }
  });

  test("indirect (x8) struct return", () => {
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const make = makeSwiftNativeFunction(fixtureFn("fixture.makeBigStruct"), Big, []);
    const r = make()!;
    for (let i = 0; i < 5; i++) {
      expect(r.add(i * 8).readU64().toNumber()).toBe(i + 1);
    }
  });

  test("direct (register-exploded) struct argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const sum = makeSwiftNativeFunction(fixtureFn("fixture.sumLoadable"), Int, [Loadable]);
    const arg = Memory.alloc(Loadable.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(10);
  });

  test("indirect struct argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const sum = makeSwiftNativeFunction(fixtureFn("fixture.sumBig"), Int, [Big]);
    const arg = Memory.alloc(Big.typeLayout.stride);
    for (let i = 0; i < 5; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(15);
  });

  test("decodes a non-POD (String) return value", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const make = makeSwiftNativeFunction(fixtureFn("fixture.makeString"), String_, []);
    expect(readString(make()!)).toBe("New Cairo");
  });

  test("survives garbage collection between creation and call", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn("fixture.addInts"), Int, [Int, Int]);
    if (typeof gc === "function") {
      gc();
      gc();
    }
    expect(add(intValue(1), intValue(2))!.readU64().toNumber()).toBe(3);
  });

  test("successive results do not alias", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn("fixture.addInts"), Int, [Int, Int]);
    const r1 = add(intValue(1), intValue(2))!;
    const r2 = add(intValue(10), intValue(20))!;
    expect(r1.equals(r2)).toBe(false);
    expect(r1.readU64().toNumber()).toBe(3);
    expect(r2.readU64().toNumber()).toBe(30);
  });

  test("passes self in the context register and the callee mutates through it", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureFn("fixture.Accumulator.add"), null, [Int], {
      hasSelf: true,
    });
    const self = Memory.alloc(8);
    self.writeU64(0);
    expect(add(self, intValue(5))).toBe(null);
    expect(self.readU64().toNumber()).toBe(5);
    add(self, intValue(10));
    expect(self.readU64().toNumber()).toBe(15);
  });

  test("returns normally when a throwing function does not throw", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const fn = makeSwiftNativeFunction(fixtureFn("fixture.mightThrow"), Int, [Int], {
      throws: true,
    });
    expect(fn(intValue(0))!.readU64().toNumber()).toBe(99);
  });

  test("surfaces a Swift error as SwiftThrownError", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const fn = makeSwiftNativeFunction(fixtureFn("fixture.mightThrow"), Int, [Int], {
      throws: true,
    });
    let thrown: unknown;
    try {
      fn(intValue(1));
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof SwiftThrownError).toBe(true);
    expect((thrown as SwiftThrownError).error.isNull()).toBe(false);
  });

  test("passes and returns a Double in the floating-point registers", () => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const fn = makeSwiftNativeFunction(fixtureFn("fixture.scaleDouble"), Double_, [Double_]);
    const arg = Memory.alloc(8);
    arg.writeDouble(21);
    expect(fn(arg)!.readDouble()).toBe(42);
  });

  test("passes and returns a Float in the floating-point registers", () => {
    const Float_ = Swift.metadataFor("Swift.Float")!;
    const fn = makeSwiftNativeFunction(fixtureFn("fixture.scaleFloat"), Float_, [Float_]);
    const arg = Memory.alloc(4);
    arg.writeFloat(21);
    expect(fn(arg)!.readFloat()).toBe(42);
  });

  test("mixes integer and floating-point argument registers", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const fn = makeSwiftNativeFunction(fixtureFn("fixture.combine"), Double_, [Int, Double_]);
    const d = Memory.alloc(8);
    d.writeDouble(40);
    expect(fn(intValue(2), d)!.readDouble()).toBe(42);
  });

  test("drives a generic function directly with supplied type metadata", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const id = makeSwiftNativeFunction(
      fixtureFn("fixture.genericIdentity"),
      { genericParam: 0 },
      [{ genericParam: 0 }],
      { typeArguments: [Int] }
    );
    expect(id(intValue(7))!.readU64().toNumber()).toBe(7);
  });

  test("a generic value argument is passed indirectly regardless of concrete size", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const id = makeSwiftNativeFunction(
      fixtureFn("fixture.genericIdentity"),
      { genericParam: 0 },
      [{ genericParam: 0 }],
      { typeArguments: [Loadable] }
    );
    const arg = Memory.alloc(Loadable.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 5);
    }
    const r = id(arg)!;
    for (let i = 0; i < 4; i++) {
      expect(r.add(i * 8).readU64().toNumber()).toBe(i + 5);
    }
  });

  test("appends one metadata argument per generic parameter", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const first = makeSwiftNativeFunction(
      fixtureFn("fixture.genericFirst"),
      { genericParam: 0 },
      [{ genericParam: 0 }, { genericParam: 1 }],
      { typeArguments: [Int, Int] }
    );
    expect(first(intValue(11), intValue(22))!.readU64().toNumber()).toBe(11);
  });

  test("appends a witness table so a constrained requirement dispatches", () => {
    loadFixture();
    const Int = Swift.metadataFor("Swift.Int")!;
    const witnessTable = conformsToProtocol(Int, findProtocol("fixture.Scalable")!)!;
    const scale = makeSwiftNativeFunction(
      fixtureFn("fixture.scaleGeneric"),
      Int,
      [{ genericParam: 0 }, Int],
      { typeArguments: [Int], witnessTables: [witnessTable] }
    );
    expect(scale(intValue(6), intValue(7))!.readU64().toNumber()).toBe(42);
  });
});
