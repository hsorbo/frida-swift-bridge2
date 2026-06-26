import { test, expect, describe } from "@frida/injest/agent";
import { requireDarwinArm64 } from "./swift.js";

import { Swift } from "../src/index.js";
import { isSwiftSymbol, demangle } from "../src/runtime/demangle.js";

describe("demangle", () => {
  test("Swift is available once libswiftCore loads", ({ skip }) => {
    requireDarwinArm64(skip);
    expect(Swift.available).toBeTruthy();
  });

  test("recognizes Swift symbol prefixes", () => {
    expect(isSwiftSymbol("$sSi")).toBeTruthy();
    expect(isSwiftSymbol("_$s4test1xyz")).toBeTruthy();
    expect(isSwiftSymbol("open")).toBeFalsy();
    expect(isSwiftSymbol("")).toBeFalsy();
  });

  test("demangles a known stdlib symbol", ({ skip }) => {
    requireDarwinArm64(skip);
    const result = demangle("$sSiMn");
    expect(result).toBeDefined();
    expect(result).toContain("Int");
  });

  test("returns null for non-Swift names", ({ skip }) => {
    requireDarwinArm64(skip);
    expect(demangle("open")).toBeNull();
  });

  test("is cached / idempotent", ({ skip }) => {
    requireDarwinArm64(skip);
    expect(demangle("$sSiMn")).toBe(demangle("$sSiMn"));
  });
});
