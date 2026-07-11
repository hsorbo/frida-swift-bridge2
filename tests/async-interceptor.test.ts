import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";

const COMPUTE_ASYNC = "$s7fixture12computeAsyncyS2iYaF";
const DRIVE = "$s7fixture17driveComputeAsyncyS2iF";

function driver(module: Module): (x: number) => number {
  const fn = new NativeFunction(module.getExportByName(DRIVE), "long", ["long"]);
  return (x) => Number(fn(x));
}

describe("async interceptor", () => {
  test("onEnter fires with the args and the async context pointer", () => {
    requireSwift();
    const module = loadFixture();
    const drive = driver(module);

    let arg: unknown;
    let context: NativePointer | undefined;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onEnter(args, ctx) {
        arg = args[0];
        context = ctx;
      },
    });
    try {
      expect(drive(21)).toBe(42);
      expect(arg).toBe(21);
      expect(context).toBeDefined();
      expect(context!.isNull()).toBe(false);
    } finally {
      listener.detach();
    }
  });

  test("onFirstSuspend fires when the function suspends", () => {
    requireSwift();
    const module = loadFixture();
    const drive = driver(module);

    let entered = false;
    let suspended = false;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onEnter() {
        entered = true;
      },
      onFirstSuspend() {
        suspended = true;
      },
    });
    try {
      expect(drive(5)).toBe(10);
      expect(entered).toBe(true);
      expect(suspended).toBe(true);
    } finally {
      listener.detach();
    }
  });
});
