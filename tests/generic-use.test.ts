import { test, expect, describe } from "@frida/injest/agent";
import { fixtureExport } from "./fixtures/load.js";

import { Swift, type SwiftValue, type CallResult } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";
import { SwiftInterceptor } from "../src/runtime/interceptor.js";

import { metadataFor } from "../src/abi.js";
describe("hook decodes generic uses", () => {
  test("resolves A? arg and return per-invocation from the recovered param", () => {
    const Int = metadataFor("Swift.Int")!;
    const roundOptional = fixtureExport("fixture.roundOptional");
    const trigger = fixtureExport("fixture.triggerRoundOptional");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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
    expect(seenArgs).toEqual([{ some: int64(9) }]);
    expect(seenRet).toEqual({ some: int64(9) });
  });
});
