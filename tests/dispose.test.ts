import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift, Value } from "../src/index.js";

describe("Symbol.dispose", () => {
  test("[Symbol.dispose]() aliases dispose() and is idempotent", ({ skip }) => {
    requireSwift(skip);
    const v = Value.fromJS(Swift.metadataFor("Swift.Int")!, 42);
    v[Symbol.dispose]();
    v[Symbol.dispose]();
    expect(() => v.get()).toThrow();
  });

  test("using disposes an owned value at block scope", ({ skip }) => {
    requireSwift(skip);
    let captured: Value;
    {
      using v = Value.fromJS(Swift.metadataFor("Swift.Int")!, 7);
      captured = v;
      expect(v.get()).toBe(7);
    }
    expect(() => captured.get()).toThrow();
  });
});
