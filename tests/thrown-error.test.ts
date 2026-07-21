import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, fixtureExport } from "./fixtures/load.js";

import { Swift, ClassInstance, SwiftThrownError } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";
import { SwiftClosure } from "../src/runtime/closure.js";
import { closureDiscriminator, closureHashString, INDIRECT } from "../src/runtime/closure-discriminator.js";

declare function gc(): void;

function intArg(n: number): NativePointer {
  return Memory.alloc(Process.pointerSize).writeS64(n);
}

describe("thrown error box ownership", () => {
  beforeEach(() => {
    loadFixture();
  });

  test("a real thrown error box carries a live, releasable payload", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const throwBoxed = makeSwiftNativeFunction(fixtureExport("fixture.throwBoxed"), Int, [Int], {
      throws: true,
    });
    let thrown: SwiftThrownError | null = null;
    try {
      throwBoxed(intArg(1));
    } catch (e) {
      thrown = e as SwiftThrownError;
    }
    expect(thrown).not.toBe(null);
    // The box is a live class instance, so its stored code reads back; releasing it many times over
    // (throw/catch/drop + gc) exercises swift_errorRelease on real boxes without leaking or crashing.
    expect(new ClassInstance(thrown!.error).retainCount).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) {
      try {
        throwBoxed(intArg(i));
      } catch {
        /* dropped: its box is released when the SwiftThrownError is collected */
      }
    }
    gc();
    gc();
    expect(new ClassInstance(thrown!.error).retainCount).toBeGreaterThan(0);
  });

  test("a script-injected closure box is never released", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const data = Memory.alloc(2);
    data.writeByteArray([0x01, 0x02]);
    const errorObj = Memory.alloc(Process.pointerSize).writePointer(ptr(0xabc));

    const discriminator = closureDiscriminator(closureHashString(["$sSW"], [INDIRECT]));
    const closure = SwiftClosure.overBytes(() => errorObj, discriminator, { throws: true });
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeGeneric"), null, [Int, Int, { closure: true }], {
      typeArguments: [Int],
      throws: true,
    });
    const baseArg = Memory.alloc(8).writePointer(data);
    const countArg = Memory.alloc(8).writeU64(2);

    let thrown: SwiftThrownError | null = null;
    try {
      invoke(baseArg, countArg, closure.value());
    } catch (e) {
      thrown = e as SwiftThrownError;
    }
    expect(thrown!.error.equals(errorObj)).toBe(true);
    thrown = null;
    // A swift_errorRelease on this non-box would corrupt the heap; skipping it keeps the fake intact.
    gc();
    gc();
    expect(errorObj.readPointer().equals(ptr(0xabc))).toBe(true);
  });
});
