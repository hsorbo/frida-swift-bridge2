import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance, writeValue } from "../src/index.js";

describe("ValueInstance", () => {
  beforeEach(() => { loadFixture(); });

  test("fromJS round-trips a struct through get", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    expect(v.owned).toBe(true);
    expect(v.read()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.dispose();
  });

  test("set overwrites a primitive in place", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    v.write(7);
    expect(v.read()).toBe(7);
    v.dispose();
  });

  test("field exposes a borrowed sub-value that mutates the parent", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    const b = v.field("b");
    expect(b.owned).toBe(false);
    b.write(99);
    expect(b.read()).toBe(99);
    expect(v.read()).toEqual({ a: 1, b: 99, c: 3, d: 4 });
    v.dispose();
  });

  test("copy is independent of the original", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const v = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 4 });
    const c = v.copy();
    c.field("a").write(100);
    expect(c.read()).toEqual({ a: 100, b: 2, c: 3, d: 4 });
    expect(v.read()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.dispose();
    c.dispose();
  });

  test("equals compares structurally, not by address", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const a = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 4 });
    const b = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 4 });
    const c = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 9 });
    expect(a.handle.equals(b.handle)).toBe(false);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    a.dispose();
    b.dispose();
    c.dispose();
  });

  test("equals is false across different value types", () => {
    const one = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    const big = ValueInstance.fromJS(Swift.metadataFor("fixture.BigStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
    });
    expect(one.equals(big)).toBe(false);
    one.dispose();
    big.dispose();
  });

  test("equals matches primitive and enum values structurally", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const a = ValueInstance.fromJS(Int, 7);
    const b = ValueInstance.fromJS(Int, 7);
    const c = ValueInstance.fromJS(Int, 8);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    a.dispose();
    b.dispose();
    c.dispose();
  });

  test("use after dispose throws; dispose is idempotent", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 42);
    v.dispose();
    v.dispose();
    expect(() => v.read()).toThrow();
  });

  test("type exposes the value's SwiftType for symmetric reflection", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("fixture.LoadableStruct")!, {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    expect(v.type.name).toBe("fixture.LoadableStruct");
    expect(Swift.typeName(v.type.metadata)).toBe("fixture.LoadableStruct");
    v.dispose();
  });

  test("kind tags the wrapper as a value instance", () => {
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    expect(v.kind).toBe("value");
    v.dispose();
  });

  test("borrowed value reads foreign memory and never disposes", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const buffer = Memory.alloc(Int.typeLayout.stride);
    writeValue(Int, buffer, 5);
    const v = ValueInstance.borrow(Int, buffer);
    expect(v.owned).toBe(false);
    expect(v.read()).toBe(5);
    v.dispose();
    expect(v.read()).toBe(5);
  });
});
