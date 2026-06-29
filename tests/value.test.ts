import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance, writeValue } from "../src/index.js";

describe("ValueInstance", () => {
  test("fromJS round-trips a struct through get", ({ skip }) => {
    loadFixture(skip);
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    expect(v.owned).toBe(true);
    expect(v.get()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.dispose();
  });

  test("set overwrites a primitive in place", ({ skip }) => {
    requireSwift(skip);
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    v.set(7);
    expect(v.get()).toBe(7);
    v.dispose();
  });

  test("field exposes a borrowed sub-value that mutates the parent", ({ skip }) => {
    loadFixture(skip);
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    const b = v.field("b");
    expect(b.owned).toBe(false);
    b.set(99);
    expect(b.get()).toBe(99);
    expect(v.get()).toEqual({ a: 1, b: 99, c: 3, d: 4 });
    v.dispose();
  });

  test("copy is independent of the original", ({ skip }) => {
    loadFixture(skip);
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const v = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 4 });
    const c = v.copy();
    c.field("a").set(100);
    expect(c.get()).toEqual({ a: 100, b: 2, c: 3, d: 4 });
    expect(v.get()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.dispose();
    c.dispose();
  });

  test("use after dispose throws; dispose is idempotent", ({ skip }) => {
    requireSwift(skip);
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 42);
    v.dispose();
    v.dispose();
    expect(() => v.get()).toThrow();
  });

  test("$type exposes the value's SwiftType for symmetric reflection", ({ skip }) => {
    loadFixture(skip);
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    expect(v.$type.name).toBe("fixture.LoadableStruct");
    expect(Swift.typeName(v.$type.metadata)).toBe("fixture.LoadableStruct");
    v.dispose();
  });

  test("borrowed value reads foreign memory and never disposes", ({ skip }) => {
    requireSwift(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    const buffer = Memory.alloc(Int.typeLayout.stride);
    writeValue(Int, buffer, 5);
    const v = ValueInstance.borrow(Int, buffer);
    expect(v.owned).toBe(false);
    expect(v.get()).toBe(5);
    v.dispose();
    expect(v.get()).toBe(5);
  });
});
