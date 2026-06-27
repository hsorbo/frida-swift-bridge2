import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType } from "../src/index.js";

function robot(name: string) {
  return Swift.Object((Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType).init(name).handle);
}

describe("Swift.Object method sugar", () => {
  test("calls a method via its escaped selector key", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.greet$_("Alice")).toBe("Hello Alice, I am R2");
  });

  test("encodes a labelled selector and mutates via a void method", ({ skip }) => {
    loadFixture(skip);
    const o = robot("old");
    expect(o.merged$with_(robot("Bee").handle)).toBe("old+Bee");
    o.rename$to_("new");
    expect(o.greet$_("X")).toBe("Hello X, I am new");
  });

  test("disambiguates arity overloads by underscore count", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.at$_(5)).toBe(5);
    expect(o.at$__(5, 6)).toBe(11);
  });

  test("$call mirrors the escaped key", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.$call("greet", "Alice")).toBe(o.greet$_("Alice"));
  });
});

describe("Swift.Object intrinsics", () => {
  test("$get / $set drive computed properties", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.$get("badge")).toBe("[R2]");
    o.$set("badge", "D2");
    expect(o.$get("badge")).toBe("[D2]");
  });

  test("$methods lists the escaped, callable keys", ({ skip }) => {
    loadFixture(skip);
    const keys = robot("R2").$methods;
    for (const k of ["greet$_", "rename$to_", "merged$with_", "at$_", "at$__"]) {
      expect(keys).toContain(k);
    }
  });

  test("$metadata / $dynamicType / handle expose the wrapped object", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.$metadata.description.fullTypeName).toBe("fixture.Robot");
    expect(Swift.typeName(o.$dynamicType)).toBe("fixture.Robot");
    expect(o.handle.isNull()).toBe(false);
  });

  test("equals compares identity; has reflects reserved + method keys", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.equals(Swift.Object(o.handle))).toBe(true);
    expect(o.equals(robot("R2"))).toBe(false);
    expect("greet$_" in o).toBe(true);
    expect("$metadata" in o).toBe(true);
    expect("nope" in o).toBe(false);
  });

  test("toString renders type and address", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.toString()).toBe(`<fixture.Robot: ${o.handle}>`);
  });
});
