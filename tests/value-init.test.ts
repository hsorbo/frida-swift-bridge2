import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, StructType } from "../src/index.js";

function structType(name: string): StructType {
  return Swift.typeOf(Swift.metadataFor(name)!) as StructType;
}

describe("value-type initializers", () => {
  test("init on a small loadable struct returns an owned Value", ({ skip }) => {
    loadFixture(skip);
    const v = structType("fixture.Point").init(5);
    expect(v.owned).toBe(true);
    expect(v.get()).toEqual({ x: 5 });
    v.dispose();
  });

  test("init marshals a String arg and adopts a non-POD return", ({ skip }) => {
    loadFixture(skip);
    const v = structType("fixture.Person").init("Ada", 36);
    expect(v.get()).toEqual({ name: "Ada", age: 36 });
    v.dispose();
  });

  test("init adopts a large struct returned indirectly", ({ skip }) => {
    loadFixture(skip);
    const v = structType("fixture.BigStruct").init(1, 2, 3, 4, 5);
    expect(v.get()).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    v.dispose();
  });

  test("a bound initializer is reusable across calls", ({ skip }) => {
    loadFixture(skip);
    const make = structType("fixture.Point").initializer();
    expect(make.call(1).get()).toEqual({ x: 1 });
    expect(make.call(2).get()).toEqual({ x: 2 });
  });

  test("throws on an argument-count mismatch", ({ skip }) => {
    loadFixture(skip);
    expect(() => structType("fixture.Person").init("Ada")).toThrow();
  });
});
