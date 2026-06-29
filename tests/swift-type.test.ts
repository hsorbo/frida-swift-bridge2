import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, StructType, EnumType, ClassType } from "../src/index.js";

describe("type wrappers", () => {
  test("StructType.new builds a value and lists fields", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.LoadableStruct")!) as StructType;
    expect(t.name).toBe("fixture.LoadableStruct");
    expect(t.fields.map((f) => f.name)).toEqual(["a", "b", "c", "d"]);
    const v = t.new({ a: 1, b: 2, c: 3, d: 4 });
    expect(v.$fields).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    v.$dispose();
  });

  test("EnumType.case builds payload and empty cases", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Pick")!) as EnumType;
    expect(t.cases.map((c) => c.name).sort()).toEqual(["empty", "value"]);
    const payload = t.case("value", 7);
    expect(payload.$fields).toEqual({ value: 7 });
    payload.$dispose();
    const empty = t.case("empty");
    expect(empty.$fields).toBe("empty");
    empty.$dispose();
  });

  test("ClassType.init runs the real initializer", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Counter")!) as ClassType;
    const obj = t.init(9);
    expect(obj.$field("count").read()).toBe(9);
    expect(obj.$fields).toEqual({ count: 9 });
  });

  test("ClassType.alloc returns raw storage we can write", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Counter")!) as ClassType;
    const obj = t.alloc();
    expect(obj.$handle.isNull()).toBe(false);
    expect(obj.$owned).toBe(true);
    obj.$field("count").write(3);
    expect(obj.$field("count").read()).toBe(3);
  });

  test("typeOf dispatches by metadata kind", () => {
    loadFixture();
    expect(Swift.typeOf(Swift.metadataFor("Swift.Int")!) instanceof StructType).toBe(true);
    expect(Swift.typeOf(Swift.metadataFor("fixture.Pick")!) instanceof EnumType).toBe(true);
    expect(Swift.typeOf(Swift.metadataFor("fixture.Counter")!) instanceof ClassType).toBe(true);
  });

  test("methods() static option splits instance from static keys", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Accumulator")!) as StructType;
    expect(t.methods().sort()).toEqual(["add(_:)", "describe(_:)", "peek(_:)"]);
    expect(t.methods({ static: true }).sort()).toEqual(["summing(_:_:)", "zero()"]);
  });

  test("type methods mirror the keys an instance's type exposes", () => {
    loadFixture();
    const t = Swift.typeOf(Swift.metadataFor("fixture.Cat")!) as ClassType;
    expect(t.methods().sort()).toEqual(t.init().$type.methods().sort());
    expect(t.methods({ static: true })).toEqual([]);
  });
});
