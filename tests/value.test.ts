import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance, writeValue } from "../src/index.js";

describe("ValueInstance", () => {
  test("fromJS round-trips a struct through get", () => {
    loadFixture();
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
    requireSwift();
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    v.write(7);
    expect(v.read()).toBe(7);
    v.dispose();
  });

  test("field exposes a borrowed sub-value that mutates the parent", () => {
    loadFixture();
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
    loadFixture();
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const v = ValueInstance.fromJS(Loadable, { a: 1, b: 2, c: 3, d: 4 });
    const c = v.copy();
    c.field("a").write(100);
    expect(c.read()).toEqual({ a: 100, b: 2, c: 3, d: 4 });
    expect(v.read()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.dispose();
    c.dispose();
  });

  test("use after dispose throws; dispose is idempotent", () => {
    requireSwift();
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 42);
    v.dispose();
    v.dispose();
    expect(() => v.read()).toThrow();
  });

  test("type exposes the value's SwiftType for symmetric reflection", () => {
    loadFixture();
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
    requireSwift();
    const v = ValueInstance.fromJS(Swift.metadataFor("Swift.Int")!, 1);
    expect(v.kind).toBe("value");
    v.dispose();
  });

  test("borrowed value reads foreign memory and never disposes", () => {
    requireSwift();
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
