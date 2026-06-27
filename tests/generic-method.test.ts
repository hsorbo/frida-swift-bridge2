import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, HeapObject } from "../src/index.js";

function box(): HeapObject {
  return (Swift.typeOf(Swift.metadataFor("fixture.Box")!) as ClassType).init() as HeapObject;
}

function robot(name: string): HeapObject {
  return (Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType).init(name) as HeapObject;
}

describe("generic method invocation", () => {
  test("calls an unconstrained generic method with a supplied type argument", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(box().method("echo", { typeArguments: [Int] }).call(7)).toBe(7);
  });

  test("the same method works for a different concrete type argument", ({ skip }) => {
    loadFixture(skip);
    const Str = Swift.metadataFor("Swift.String")!;
    expect(box().method("echo", { typeArguments: [Str] }).call("hi")).toBe("hi");
  });

  test("appends one metadata argument per generic parameter", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    const Str = Swift.metadataFor("Swift.String")!;
    expect(box().method("pick", { typeArguments: [Int, Str] }).call(11, "x")).toBe(11);
  });

  test("auto-resolves a witness table for a constrained requirement", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(box().method("scaled", { typeArguments: [Int] }).call(6, 7)).toBe(42);
  });

  test("passes a class-typed generic argument by reference", ({ skip }) => {
    loadFixture(skip);
    const Robot = Swift.metadataFor("fixture.Robot")!;
    const r = robot("R2");
    const back = box().method("echo", { typeArguments: [Robot] }).call(r.handle) as NativePointer;
    expect(back.equals(r.handle)).toBe(true);
  });

  test("a bound generic method is reusable across calls", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    const echo = box().method("echo", { typeArguments: [Int] });
    expect(echo.call(1)).toBe(1);
    expect(echo.call(2)).toBe(2);
  });

  test("rejects a type that fails the conformance requirement", ({ skip }) => {
    loadFixture(skip);
    const Str = Swift.metadataFor("Swift.String")!;
    expect(() => box().method("scaled", { typeArguments: [Str] })).toThrow();
  });

  test("rejects a mismatched type-argument count", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(() => box().method("pick", { typeArguments: [Int] })).toThrow();
  });
});
