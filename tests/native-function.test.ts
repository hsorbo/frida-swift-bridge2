import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift, type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import { SwiftThrownError } from "../src/runtime/calling-convention.js";

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

describe("Swift.NativeFunction", () => {
  test("accepts raw metadata for return and argument types", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = Swift.NativeFunction(fixtureFn(skip, "fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("accepts high-level SwiftType, lowering it to metadata", ({ skip }) => {
    const Int = Swift.typeOf(Swift.metadataFor("Swift.Int")!);
    const add = Swift.NativeFunction(fixtureFn(skip, "fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("mixes a SwiftType struct argument with a SwiftType return", ({ skip }) => {
    const Int = Swift.typeOf(Swift.metadataFor("Swift.Int")!);
    const Loadable = Swift.typeOf(Swift.metadataFor("fixture.LoadableStruct")!);
    const sum = Swift.NativeFunction(fixtureFn(skip, "fixture.sumLoadable"), Int, [Loadable]);
    const arg = Memory.alloc(Loadable.metadata.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(10);
  });

  test("forwards options to the underlying trampoline (throws)", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const fn = Swift.NativeFunction(fixtureFn(skip, "fixture.mightThrow"), Int, [Int], {
      throws: true,
    });
    expect(fn(intValue(0))!.readU64().toNumber()).toBe(99);
    let thrown: unknown;
    try {
      fn(intValue(1));
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof SwiftThrownError).toBe(true);
  });

  test("passes a GenericRef through unchanged", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const id = Swift.NativeFunction(
      fixtureFn(skip, "fixture.genericIdentity"),
      { genericParam: 0 },
      [{ genericParam: 0 }],
      { typeArguments: [Int] }
    );
    expect(id(intValue(7))!.readU64().toNumber()).toBe(7);
  });
});
