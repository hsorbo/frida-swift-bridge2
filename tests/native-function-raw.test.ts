import { test, expect, describe } from "@frida/injest/agent";
import { fixtureExport } from "./fixtures/load.js";

import { makeSwiftNativeFunction, SwiftError, metadataFor } from "../src/abi.js";

function intValue(v: number): NativePointer {
  const p = Memory.alloc(8);
  p.writeU64(v);
  return p;
}

describe("makeSwiftNativeFunction (raw pointer-buffer)", () => {
  test("accepts raw metadata for return and argument types", () => {
    const Int = metadataFor("Swift.Int")!;
    const add = makeSwiftNativeFunction(fixtureExport("fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("passes a struct argument by value buffer", () => {
    const Int = metadataFor("Swift.Int")!;
    const Loadable = metadataFor("fixture.LoadableStruct")!;
    const sum = makeSwiftNativeFunction(fixtureExport("fixture.sumLoadable"), Int, [Loadable]);
    const arg = Memory.alloc(Loadable.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(10);
  });

  test("forwards options to the underlying trampoline (throws)", () => {
    const Int = metadataFor("Swift.Int")!;
    const fn = makeSwiftNativeFunction(fixtureExport("fixture.mightThrow"), Int, [Int], {
      throws: true,
    });
    expect(fn(intValue(0))!.readU64().toNumber()).toBe(99);
    let thrown: unknown;
    try {
      fn(intValue(1));
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof SwiftError).toBe(true);
  });

  test("passes a GenericRef through the supplied type argument", () => {
    const Int = metadataFor("Swift.Int")!;
    const id = makeSwiftNativeFunction(
      fixtureExport("fixture.genericIdentity"),
      { genericParam: 0 },
      [{ genericParam: 0 }],
      { typeArguments: [Int] }
    );
    expect(id(intValue(7))!.readU64().toNumber()).toBe(7);
  });
});
