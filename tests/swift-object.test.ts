import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType } from "../src/index.js";

function robot(name: string) {
  return (Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType).init(name);
}

function cat() {
  return (Swift.typeOf(Swift.metadataFor("fixture.Cat")!) as ClassType).init();
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

  test("disambiguates same-arity overloads by label key", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.move$to_(5)).toBe(5);
    expect(o.move$by_(5)).toBe(50);
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

  test("$type.methods() lists the escaped, callable keys", ({ skip }) => {
    loadFixture(skip);
    const keys = robot("R2").$type.methods();
    for (const k of ["greet$_", "rename$to_", "merged$with_", "at$_", "at$__"]) {
      expect(keys).toContain(k);
    }
  });

  test("$className reflects the dynamic type", ({ skip }) => {
    loadFixture(skip);
    expect(cat().$className).toBe("fixture.Cat");
    expect(robot("R2").$className).toBe("fixture.Robot");
  });

  test("$type.superClass wraps the parent, null at a root class", ({ skip }) => {
    loadFixture(skip);
    const sup = cat().$type.superClass;
    expect(sup).not.toBeNull();
    expect(sup!.name).toBe("fixture.Animal");
    expect(robot("R2").$type.superClass).toBeNull();
  });

  test("$type.moduleName points at the defining image", ({ skip }) => {
    loadFixture(skip);
    expect(robot("R2").$type.moduleName).toContain("fixture.dylib");
  });

  test("methods({ inherited: false }) excludes inherited methods that methods() includes", ({ skip }) => {
    loadFixture(skip);
    const t = cat().$type;
    expect(t.methods()).toContain("speak");
    expect(t.methods()).toContain("legs");
    expect(t.methods({ inherited: false })).toContain("speak");
    expect(t.methods({ inherited: false })).not.toContain("legs");
  });

  test("$type / handle expose the wrapped object", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.$type.name).toBe("fixture.Robot");
    expect(Swift.typeName(o.$type.metadata)).toBe("fixture.Robot");
    expect(o.handle.isNull()).toBe(false);
  });

  test("equals compares identity; has reflects reserved + method keys", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.equals(Swift.Object(o.handle))).toBe(true);
    expect(o.equals(robot("R2"))).toBe(false);
    expect("greet$_" in o).toBe(true);
    expect("$type" in o).toBe(true);
    expect("nope" in o).toBe(false);
  });

  test("toString renders type and address", ({ skip }) => {
    loadFixture(skip);
    const o = robot("R2");
    expect(o.toString()).toBe(`<fixture.Robot: ${o.handle}>`);
  });
});
