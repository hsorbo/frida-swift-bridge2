import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, AsyncFunctionPointer, driveAsyncCall } from "../src/index.js";

const COMPUTE_ASYNC = "$s7fixture12computeAsyncyS2iYaF";
const DRIVE = "$s7fixture17driveComputeAsyncyS2iF";
const MAKE_QUAD_ASYNC = "$s7fixture13makeQuadAsyncyAA0dC0VSiYaF";
const MAKE_QUAD_ASYNC_AFP = MAKE_QUAD_ASYNC + "Tu";
const DIVIDE_ASYNC = "$s7fixture11divideAsyncyS2i_SitYaKF";
const DIVIDE_ASYNC_AFP = DIVIDE_ASYNC + "Tu";

function driver(module: Module): (x: number) => number {
  const fn = new NativeFunction(module.getExportByName(DRIVE), "long", ["long"]);
  return (x) => Number(fn(x));
}

function afp(module: Module, symbol: string): AsyncFunctionPointer {
  return new AsyncFunctionPointer(module.getExportByName(symbol).strip());
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

  test("onComplete fires with the return value once the awaited function resolves", () => {
    requireSwift();
    const module = loadFixture();
    const drive = driver(module);

    let result: unknown;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onComplete(retval) {
        result = retval;
      },
    });
    try {
      expect(drive(21)).toBe(42);
      expect(result).toBe(42);
    } finally {
      listener.detach();
    }
  });

  test("onEnter, onFirstSuspend and onComplete all fire in order", () => {
    requireSwift();
    const module = loadFixture();
    const drive = driver(module);

    const seen: string[] = [];
    let result: unknown;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onEnter() {
        seen.push("enter");
      },
      onFirstSuspend() {
        seen.push("suspend");
      },
      onComplete(retval) {
        seen.push("complete");
        result = retval;
      },
    });
    try {
      expect(drive(9)).toBe(18);
      expect(seen).toEqual(["enter", "suspend", "complete"]);
      expect(result).toBe(18);
    } finally {
      listener.detach();
    }
  });

  test("onComplete captures a large @out struct result: makeQuadAsync(10)", () => {
    requireSwift();
    const module = loadFixture();

    let quad: { a: number; e: number } | undefined;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(MAKE_QUAD_ASYNC), {
      onComplete(retval) {
        quad = retval as { a: number; e: number };
      },
    });
    try {
      driveAsyncCall(afp(module, MAKE_QUAD_ASYNC_AFP), [ptr(10)], { result: { kind: "indirect", stride: 40 } });
      expect(quad).toBeDefined();
      expect(quad!.a).toBe(10);
      expect(quad!.e).toBe(14);
    } finally {
      listener.detach();
    }
  });

  test("onComplete surfaces a thrown error", () => {
    requireSwift();
    const module = loadFixture();

    let value: unknown = "unset";
    let error: unknown;
    const listener = Swift.Interceptor.attachAsync(module.getExportByName(DIVIDE_ASYNC), {
      onComplete(retval, err) {
        value = retval;
        error = err;
      },
    });
    try {
      expect(() =>
        driveAsyncCall(afp(module, DIVIDE_ASYNC_AFP), [ptr(10), ptr(0)], { throws: true })
      ).toThrow();
      expect(value).toBe(null);
      expect(error).toBeDefined();
    } finally {
      listener.detach();
    }
  });
});
