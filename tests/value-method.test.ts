import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance } from "../src/index.js";

function value(typeName: string, fields: { [k: string]: number }): ValueInstance {
  return ValueInstance.fromJS(Swift.metadataFor(typeName)!, fields);
}

describe("ValueInstance method invocation", () => {
  beforeEach(() => { loadFixture(); });

  test("non-mutating method on a small loadable struct (self as trailing arg)", () => {
    expect(value("fixture.Accumulator", { total: 5 }).call("peek", 10)).toEqual(int64(15));
  });

  test("mutating method writes back through the inout self pointer", () => {
    const v = value("fixture.Accumulator", { total: 5 });
    v.method("add", { mutating: true }).call(3);
    expect((v.read() as { total: number }).total).toEqual(int64(8));
  });

  test("String arg and return marshal across a trailing-self call", () => {
    expect(value("fixture.Accumulator", { total: 7 }).call("describe", "T")).toBe("T: 7");
  });

  test("multi-word loadable self rides in successive registers after the args", () => {
    expect(value("fixture.LoadableStruct", { a: 1, b: 2, c: 3, d: 4 }).call("dot", 2)).toEqual(int64(20));
  });

  test("large struct passes self indirectly in x20", () => {
    expect(value("fixture.BigStruct", { a: 1, b: 2, c: 3, d: 4, e: 5 }).call("total")).toEqual(int64(15));
  });

  test("a bound value method is reusable across calls", () => {
    const peek = value("fixture.Accumulator", { total: 100 }).method("peek");
    expect(peek.call(1)).toEqual(int64(101));
    expect(peek.call(2)).toEqual(int64(102));
  });
});
