import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift, ValueInstance } from "../src/index.js";

describe("Symbol.dispose", () => {
  test("[Symbol.dispose]() aliases dispose() and is idempotent", () => {
    requireSwift();
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 42);
    v[Symbol.dispose]();
    v[Symbol.dispose]();
    expect(() => v.read()).toThrow();
  });

  test("using disposes an owned value at block scope", () => {
    requireSwift();
    let captured: ValueInstance;
    {
      using v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 7);
      captured = v;
      expect(v.read()).toEqual(int64(7));
    }
    expect(() => captured.read()).toThrow();
  });
});
