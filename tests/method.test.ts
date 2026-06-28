import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, StructType, SwiftObject } from "../src/index.js";
import {
  resolveMethod,
  enumerateMethods,
  enumerateProperties,
} from "../src/runtime/method.js";
import { parseSwiftSignature, type SwiftFunctionSignature } from "../src/runtime/symbolication.js";

function robotType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType;
}

describe("parser labels", () => {
  test("captures argument labels and a canonical selector", () => {
    const s = parseSwiftSignature(
      "fixture.Robot.rename(to: Swift.String) -> ()"
    ) as SwiftFunctionSignature;
    expect(s.argLabels).toEqual(["to"]);
    expect(s.selector).toBe("rename(to:)");
  });

  test("renders unlabelled args as _ in the selector", () => {
    const s = parseSwiftSignature("fixture.addInts(Swift.Int, Swift.Int) -> Swift.Int") as SwiftFunctionSignature;
    expect(s.argLabels).toEqual([null, null]);
    expect(s.selector).toBe("addInts(_:_:)");
  });

  test("a no-arg function selects to name()", () => {
    const s = parseSwiftSignature("fixture.makeString() -> Swift.String") as SwiftFunctionSignature;
    expect(s.selector).toBe("makeString()");
  });
});

describe("resolveMethod", () => {
  test("resolves an instance method to address + typed signature", ({ skip }) => {
    loadFixture(skip);
    const m = resolveMethod("fixture.Robot", "greet", { static: false });
    expect(m.address.isNull()).toBe(false);
    expect(m.isStatic).toBe(false);
    expect(m.selector).toBe("greet(_:)");
    expect(Swift.typeName(m.argTypes[0])).toBe("Swift.String");
    expect(Swift.typeName(m.returnType!)).toBe("Swift.String");
  });

  test("distinguishes a static method", ({ skip }) => {
    loadFixture(skip);
    const m = resolveMethod("fixture.Robot", "make", { static: true });
    expect(m.isStatic).toBe(true);
    expect(Swift.typeName(m.returnType!)).toBe("fixture.Robot");
  });

  test("throws on an ambiguous overload, resolves by arity", ({ skip }) => {
    loadFixture(skip);
    expect(() => resolveMethod("fixture.Robot", "at")).toThrow();
    expect(resolveMethod("fixture.Robot", "at", { arity: 1 }).argTypes.length).toBe(1);
    expect(resolveMethod("fixture.Robot", "at", { arity: 2 }).argTypes.length).toBe(2);
  });

  test("disambiguates a same-arity overload by labels", ({ skip }) => {
    loadFixture(skip);
    expect(() => resolveMethod("fixture.Robot", "move")).toThrow();
    expect(() => resolveMethod("fixture.Robot", "move", { arity: 1 })).toThrow();
    expect(resolveMethod("fixture.Robot", "move", { labels: ["to"] }).selector).toBe("move(to:)");
    expect(resolveMethod("fixture.Robot", "move", { labels: ["by"] }).selector).toBe("move(by:)");
  });

  test("disambiguates a same-arity, same-label overload by argTypes", ({ skip }) => {
    loadFixture(skip);
    expect(() => resolveMethod("fixture.Robot", "tagged")).toThrow();
    expect(() => resolveMethod("fixture.Robot", "tagged", { labels: [null] })).toThrow();
    const i = resolveMethod("fixture.Robot", "tagged", { argTypes: ["Swift.Int"] });
    expect(Swift.typeName(i.argTypes[0])).toBe("Swift.Int");
    const s = resolveMethod("fixture.Robot", "tagged", { argTypes: ["Swift.String"] });
    expect(Swift.typeName(s.argTypes[0])).toBe("Swift.String");
  });
});

describe("enumerateMethods", () => {
  test("lists methods with kind/isStatic/arity", ({ skip }) => {
    loadFixture(skip);
    const methods = enumerateMethods("fixture.Robot");
    const rename = methods.find((m) => m.selector === "rename(to:)")!;
    expect(rename.isStatic).toBe(false);
    expect(rename.argLabels).toEqual(["to"]);
    expect(rename.returnTypeName).toBeNull();
    expect(methods.some((m) => m.name === "make" && m.isStatic)).toBe(true);
    expect(methods.filter((m) => m.name === "at").length).toBe(2);
  });

  test("strips the operator fixity keyword; a generic return is still a bare placeholder", ({ skip }) => {
    loadFixture(skip);
    const methods = enumerateMethods("fixture.Selectors");
    const eq = methods.find((m) => m.name === "==")!;
    expect(eq.selector).toBe("==(_:_:)");
    expect(eq.isStatic).toBe(true);
    expect(eq.returnTypeName).toBe("Swift.Bool");
    expect(methods.find((m) => m.name === "echo")!.returnTypeName).toBe("A");
  });
});

describe("enumerateProperties", () => {
  test("merges get/set into one writable entry per property", ({ skip }) => {
    loadFixture(skip);
    const props = enumerateProperties("fixture.Point");
    const doubled = props.find((p) => p.name === "doubled")!;
    expect(doubled.typeName).toBe("Swift.Int");
    expect(doubled.isStatic).toBe(false);
    expect(doubled.writable).toBe(false);
    expect(props.find((p) => p.name === "x")!.writable).toBe(true);
    expect(props.filter((p) => p.name === "x").length).toBe(1);
  });

  test("is exposed on the type wrapper as .properties", ({ skip }) => {
    loadFixture(skip);
    const point = Swift.typeOf(Swift.metadataFor("fixture.Point")!) as StructType;
    expect(point.properties.map((p) => p.name).sort()).toEqual(["doubled", "x"]);
  });

  test("lists class properties with their types", ({ skip }) => {
    loadFixture(skip);
    const props = enumerateProperties("fixture.Robot");
    const badge = props.find((p) => p.name === "badge")!;
    expect(badge.typeName).toBe("Swift.String");
    expect(badge.writable).toBe(true);
  });
});

describe("HeapObject method invocation", () => {
  test("calls an instance method with a String arg and return", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(obj.call("greet", "Alice")).toBe("Hello Alice, I am R2");
  });

  test("calls a void method that mutates state", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("old");
    expect(obj.field("name").get()).toBe("old");
    obj.call("rename", "new");
    expect(obj.field("name").get()).toBe("new");
  });

  test("passes a class-typed argument", ({ skip }) => {
    loadFixture(skip);
    const a = robotType().init("Ada");
    const b = robotType().init("Bee");
    expect(a.call("merged", b.handle)).toBe("Ada+Bee");
  });

  test("reuses a resolved method across calls", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    const greet = obj.method("greet");
    expect(greet.call("X")).toBe("Hello X, I am R2");
    expect(greet.call("Y")).toBe("Hello Y, I am R2");
  });

  test("disambiguates an overload by arity", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(obj.method("at", { arity: 1 }).call(5)).toBe(5);
    expect(obj.method("at", { arity: 2 }).call(5, 6)).toBe(11);
  });

  test("disambiguates a same-arity overload by labels", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(obj.method("move", { labels: ["to"] }).call(5)).toBe(5);
    expect(obj.method("move", { labels: ["by"] }).call(5)).toBe(50);
  });

  test("disambiguates a same-arity, same-label overload by argTypes", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(obj.method("tagged", { argTypes: ["Swift.Int"] }).call(7)).toBe("int:7");
    expect(obj.method("tagged", { argTypes: ["Swift.String"] }).call("hi")).toBe("str:hi");
  });
});

describe("HeapObject computed property", () => {
  test("invokes a getter", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(obj.get("badge")).toBe("[R2]");
  });

  test("invokes a setter, observable via getter and stored field", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    obj.set("badge", "D2");
    expect(obj.field("name").get()).toBe("D2");
    expect(obj.get("badge")).toBe("[D2]");
  });

  test("throws for an unknown property", ({ skip }) => {
    loadFixture(skip);
    const obj = robotType().init("R2");
    expect(() => obj.get("nope")).toThrow();
  });
});

describe("ClassType static invocation", () => {
  test("calls a static factory and wraps the class return", ({ skip }) => {
    loadFixture(skip);
    const made = robotType().call("make", "Forged") as SwiftObject;
    expect(made.$owned).toBe(true);
    expect(made.field("name").get()).toBe("Forged");
  });
});
