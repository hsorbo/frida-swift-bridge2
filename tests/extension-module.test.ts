import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, loadExtensions } from "./fixtures/load.js";

import { Swift, ClassType } from "../src/index.js";
import { enumerateMethods, enumerateProperties, resolveMethod } from "../src/runtime/method.js";

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

  test("they are callable and readable through the facade", () => {
    const robot = (Swift.type("fixture.Robot") as ClassType).init("R2");
    expect(robot.fly()).toBe("fly R2");
    expect(Number(robot.wingspan)).toBe(2);
  });
});
