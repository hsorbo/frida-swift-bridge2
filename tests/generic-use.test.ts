import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, type SwiftValue } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";
import { SwiftInterceptor } from "../src/runtime/interceptor.js";

function fixtureAddress(skip: Skip, swiftName: string): NativePointer {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

describe("hook decodes generic uses", () => {
  test("resolves A? arg and return per-invocation from the recovered param", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const roundOptional = fixtureAddress(skip, "fixture.roundOptional");
    const trigger = fixtureAddress(skip, "fixture.triggerRoundOptional");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(roundOptional, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(trigger, Int, [])();
    listener.detach();
    expect(seenArgs).toEqual([{ some: 9 }]);
    expect(seenRet).toEqual({ some: 9 });
  });
});
