import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, loadExtensions } from "./fixtures/load.js";

import { Swift, ClassType, StructType } from "../src/index.js";
import { enumerateMethods, enumerateProperties, resolveMethod } from "../src/runtime/method.js";
import { metadataFor, typeOf } from "../src/abi.js";

// Runs before anything in this process loads the extending module, so it must come first.
describe("a module loaded after the search has already run", () => {
  test("its members are missing until it loads, then resolve without a flush", () => {
    loadFixture();
    expect(() => resolveMethod("fixture.Robot", "fly")).toThrow();
    expect(enumerateMethods("fixture.Robot").some((m) => m.name === "fly")).toBeFalsy();

    loadExtensions();

    expect(resolveMethod("fixture.Robot", "fly").selector).toBe("fly()");
    expect((Swift.type("fixture.Robot") as ClassType).init("R2").fly()).toBe("fly R2");
  });
});

describe("a type extended from another module", () => {
  beforeEach(() => { loadExtensions(); });

  test("member discovery reaches them", () => {
    expect(enumerateMethods("fixture.Robot").some((m) => m.name === "fly")).toBeTruthy();
    expect(enumerateProperties("fixture.Robot").some((p) => p.name === "wingspan")).toBeTruthy();
    expect((Swift.type("fixture.Robot") as ClassType).methods()).toContain("fly()");
  });

  test("a generic type's extension members are found and callable", () => {
    expect(enumerateMethods("fixture.Pair").some((m) => m.name === "labelled")).toBeTruthy();
    const pairOfInt = typeOf(metadataFor("fixture.Pair", [metadataFor("Swift.Int")!])!) as StructType;
    expect(pairOfInt.new({ first: 1, second: 2 }).labelled()).toBe("pair");
  });

  test("they are callable and readable through the facade", () => {
    const robot = (Swift.type("fixture.Robot") as ClassType).init("R2");
    expect(robot.fly()).toBe("fly R2");
    expect(Number(robot.wingspan)).toBe(2);
  });
});
