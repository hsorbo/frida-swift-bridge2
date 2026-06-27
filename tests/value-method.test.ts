import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Value } from "../src/index.js";

function value(typeName: string, fields: { [k: string]: number }): Value {
  return Value.fromJS(Swift.metadataFor(typeName)!, fields);
}

describe("Value method invocation", () => {
  test("non-mutating method on a small loadable struct (self as trailing arg)", ({ skip }) => {
    loadFixture(skip);
    expect(value("fixture.Accumulator", { total: 5 }).call("peek", 10)).toBe(15);
  });

  test("mutating method writes back through the inout self pointer", ({ skip }) => {
    loadFixture(skip);
    const v = value("fixture.Accumulator", { total: 5 });
    v.method("add", { mutating: true }).call(3);
    expect((v.get() as { total: number }).total).toBe(8);
  });

  test("String arg and return marshal across a trailing-self call", ({ skip }) => {
    loadFixture(skip);
    expect(value("fixture.Accumulator", { total: 7 }).call("describe", "T")).toBe("T: 7");
  });

  test("multi-word loadable self rides in successive registers after the args", ({ skip }) => {
    loadFixture(skip);
    expect(value("fixture.LoadableStruct", { a: 1, b: 2, c: 3, d: 4 }).call("dot", 2)).toBe(20);
  });

  test("large struct passes self indirectly in x20", ({ skip }) => {
    loadFixture(skip);
    expect(value("fixture.BigStruct", { a: 1, b: 2, c: 3, d: 4, e: 5 }).call("total")).toBe(15);
  });

  test("a bound value method is reusable across calls", ({ skip }) => {
    loadFixture(skip);
    const peek = value("fixture.Accumulator", { total: 100 }).method("peek");
    expect(peek.call(1)).toBe(101);
    expect(peek.call(2)).toBe(102);
  });
});
