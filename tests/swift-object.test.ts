import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture, FIXTURE_MODULE } from "./fixtures/load.js";

import { Swift, ClassType } from "../src/index.js";

function robot(name: string) {
  return (Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType).init(name);
}

function cat() {
  return (Swift.typeOf(Swift.metadataFor("fixture.Cat")!) as ClassType).init();
}

describe("Swift.Object method sugar", () => {
  test("calls a method by its bare name", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.greet("Alice")).toBe("Hello Alice, I am R2");
  });

  test("calls a labelled method and mutates via a void method", () => {
    loadFixture();
    const o = robot("old");
    expect(o.merged(robot("Bee").$handle)).toBe("old+Bee");
    o.rename("new");
    expect(o.greet("X")).toBe("Hello X, I am new");
  });

  test("disambiguates arity overloads by argument count", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.at(5)).toBe(5);
    expect(o.at(5, 6)).toBe(11);
  });

  test("disambiguates same-arity overloads via $method labels", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.$method("move", { labels: ["to"] }).call(5)).toBe(5);
    expect(o.$method("move", { labels: ["by"] }).call(5)).toBe(50);
  });

  test("$call mirrors the bare-name call", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.$call("greet", "Alice")).toBe(o.greet("Alice"));
  });
});

describe("Swift.Object intrinsics", () => {
  test("$get / $set drive computed properties", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.$get("badge")).toBe("[R2]");
    o.$set("badge", "D2");
    expect(o.$get("badge")).toBe("[D2]");
  });

  test("$type.methods() lists callable selectors", () => {
    loadFixture();
    const selectors = robot("R2").$type.methods();
    for (const s of ["greet(_:)", "rename(to:)", "merged(with:)", "at(_:)", "at(_:_:)"]) {
      expect(selectors).toContain(s);
    }
  });

  test("$className reflects the dynamic type", () => {
    loadFixture();
    expect(cat().$className).toBe("fixture.Cat");
    expect(robot("R2").$className).toBe("fixture.Robot");
  });

  test("$type.superClass wraps the parent, null at a root class", () => {
    loadFixture();
    const sup = cat().$type.superClass;
    expect(sup).not.toBeNull();
    expect(sup!.name).toBe("fixture.Animal");
    expect(robot("R2").$type.superClass).toBeNull();
  });

  test("$type.moduleName points at the defining image", () => {
    loadFixture();
    expect(robot("R2").$type.moduleName).toContain(FIXTURE_MODULE);
  });

  test("methods({ inherited: false }) excludes inherited methods that methods() includes", () => {
    loadFixture();
    const t = cat().$type;
    expect(t.methods()).toContain("speak()");
    expect(t.methods()).toContain("legs()");
    expect(t.methods({ inherited: false })).toContain("speak()");
    expect(t.methods({ inherited: false })).not.toContain("legs()");
  });

  test("$type / $handle expose the wrapped object", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.$type.name).toBe("fixture.Robot");
    expect(Swift.typeName(o.$type.metadata)).toBe("fixture.Robot");
    expect(o.$handle.isNull()).toBe(false);
  });

  test("$kind tags the facade as an object instance", () => {
    loadFixture();
    expect(robot("R2").$kind).toBe("object");
  });

  test("equals compares identity; has reflects reserved + member names", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.equals(Swift.Object(o.$handle))).toBe(true);
    expect(o.equals(robot("R2"))).toBe(false);
    expect("greet" in o).toBe(true);
    expect("$type" in o).toBe(true);
    expect("nope" in o).toBe(false);
  });

  test("toString renders type and address", () => {
    loadFixture();
    const o = robot("R2");
    expect(o.toString()).toBe(`<fixture.Robot: ${o.$handle}>`);
  });
});
