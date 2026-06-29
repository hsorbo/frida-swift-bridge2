import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, StructType, EnumType } from "../src/index.js";

function structType(name: string): StructType {
  return Swift.typeOf(Swift.metadataFor(name)!) as StructType;
}

describe("Static value-type method invocation", () => {
  test("static method on a struct passes no self", () => {
    loadFixture();
    expect(structType("fixture.Accumulator").call("summing", 4, 5)).toBe(9);
  });

  test("static factory returns the value type", () => {
    loadFixture();
    expect(structType("fixture.Accumulator").call("zero")).toEqual({ total: 0 });
  });

  test("static method on an enum passes no self", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Pick")!) as EnumType;
    expect(t.call("tag", 21)).toBe(42);
  });

  test("a bound static method is reusable across calls", () => {
    loadFixture();
    const summing = structType("fixture.Accumulator").method("summing");
    expect(summing.call(1, 2)).toBe(3);
    expect(summing.call(10, 20)).toBe(30);
  });
});
