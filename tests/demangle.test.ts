import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { isSwiftSymbol, demangle } from "../src/runtime/demangle.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
}

describe("demangle", () => {
  test("Swift is available once libswiftCore loads", ({ skip }) => {
    requireSwift(skip);
    expect(Swift.available).toBeTruthy();
  });

  test("recognizes Swift symbol prefixes", () => {
    expect(isSwiftSymbol("$sSi")).toBeTruthy();
    expect(isSwiftSymbol("_$s4test1xyz")).toBeTruthy();
    expect(isSwiftSymbol("open")).toBeFalsy();
    expect(isSwiftSymbol("")).toBeFalsy();
  });

  test("demangles a known stdlib symbol", ({ skip }) => {
    requireSwift(skip);
    const result = demangle("$sSiMn");
    expect(result).toBeDefined();
    expect(result).toContain("Int");
  });

  test("returns null for non-Swift names", ({ skip }) => {
    requireSwift(skip);
    expect(demangle("open")).toBeNull();
  });

  test("is cached / idempotent", ({ skip }) => {
    requireSwift(skip);
    expect(demangle("$sSiMn")).toBe(demangle("$sSiMn"));
  });
});
