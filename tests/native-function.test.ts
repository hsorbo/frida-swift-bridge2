import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { fixtureExport } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import { SwiftThrownError } from "../src/runtime/calling-convention.js";

function intValue(v: number): NativePointer {
  const p = Memory.alloc(8);
  p.writeU64(v);
  return p;
}

describe("Swift.NativeFunction", () => {
  test("accepts raw metadata for return and argument types", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const add = Swift.NativeFunction(fixtureExport("fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("accepts high-level SwiftType, lowering it to metadata", () => {
    const Int = Swift.typeOf(Swift.metadataFor("Swift.Int")!);
    const add = Swift.NativeFunction(fixtureExport("fixture.addInts"), Int, [Int, Int]);
    expect(add(intValue(20), intValue(22))!.readU64().toNumber()).toBe(42);
  });

  test("mixes a SwiftType struct argument with a SwiftType return", () => {
    const Int = Swift.typeOf(Swift.metadataFor("Swift.Int")!);
    const Loadable = Swift.typeOf(Swift.metadataFor("fixture.LoadableStruct")!);
    const sum = Swift.NativeFunction(fixtureExport("fixture.sumLoadable"), Int, [Loadable]);
    const arg = Memory.alloc(Loadable.metadata.typeLayout.stride);
    for (let i = 0; i < 4; i++) {
      arg.add(i * 8).writeU64(i + 1);
    }
    expect(sum(arg)!.readU64().toNumber()).toBe(10);
  });

  test("forwards options to the underlying trampoline (throws)", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const fn = Swift.NativeFunction(fixtureExport("fixture.mightThrow"), Int, [Int], {
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

  test("passes a GenericRef through unchanged", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const id = Swift.NativeFunction(
      fixtureExport("fixture.genericIdentity"),
      { genericParam: 0 },
      [{ genericParam: 0 }],
      { typeArguments: [Int] }
    );
    expect(id(intValue(7))!.readU64().toNumber()).toBe(7);
  });
});
