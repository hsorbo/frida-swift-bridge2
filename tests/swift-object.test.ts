import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, FIXTURE_MODULE } from "./fixtures/load.js";

import { Swift, ClassType } from "../src/index.js";

function robot(name: string) {
  return (Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType).init(name);
}

function cat() {
  return (Swift.typeOf(Swift.metadataFor("fixture.Cat")!) as ClassType).init();
}

describe("Swift.Object method sugar", () => {
  beforeEach(() => { loadFixture(); });

  test("calls a method by its bare name", () => {
    const o = robot("R2");
    expect(o.greet("Alice")).toBe("Hello Alice, I am R2");
  });

  test("calls a labelled method and mutates via a void method", () => {
    const o = robot("old");
    expect(o.merged(robot("Bee").$handle)).toBe("old+Bee");
    o.rename("new");
    expect(o.greet("X")).toBe("Hello X, I am new");
  });

  test("disambiguates arity overloads by argument count", () => {
    const o = robot("R2");
    expect(o.at(5)).toEqual(int64(5));
    expect(o.at(5, 6)).toEqual(int64(11));
  });

  test("disambiguates same-arity overloads via $method labels", () => {
    const o = robot("R2");
    expect(o.$method("move", { labels: ["to"] }).call(5)).toEqual(int64(5));
    expect(o.$method("move", { labels: ["by"] }).call(5)).toEqual(int64(50));
  });

  test("$call mirrors the bare-name call", () => {
    const o = robot("R2");
    expect(o.$call("greet", "Alice")).toBe(o.greet("Alice"));
  });
});

describe("Swift.Object intrinsics", () => {
  beforeEach(() => { loadFixture(); });

  test("$get / $set drive computed properties", () => {
    const o = robot("R2");
    expect(o.$get("badge")).toBe("[R2]");
    o.$set("badge", "D2");
    expect(o.$get("badge")).toBe("[D2]");
  });

  test("$type.methods() lists callable selectors", () => {
    const selectors = robot("R2").$type.methods();
    for (const s of ["greet(_:)", "rename(to:)", "merged(with:)", "at(_:)", "at(_:_:)"]) {
      expect(selectors).toContain(s);
    }
  });

  test("$className reflects the dynamic type", () => {
    expect(cat().$className).toBe("fixture.Cat");
    expect(robot("R2").$className).toBe("fixture.Robot");
  });

  test("$type.superClass wraps the parent, null at a root class", () => {
    const sup = cat().$type.superClass;
    expect(sup).not.toBeNull();
    expect(sup!.name).toBe("fixture.Animal");
    expect(robot("R2").$type.superClass).toBeNull();
  });

  test("$type.moduleName points at the defining image", () => {
    expect(robot("R2").$type.moduleName).toContain(FIXTURE_MODULE);
  });

  test("methods({ inherited: false }) excludes inherited methods that methods() includes", () => {
    const t = cat().$type;
    expect(t.methods()).toContain("speak()");
    expect(t.methods()).toContain("legs()");
    expect(t.methods({ inherited: false })).toContain("speak()");
    expect(t.methods({ inherited: false })).not.toContain("legs()");
  });

  test("$type / $handle expose the wrapped object", () => {
    const o = robot("R2");
    expect(o.$type.name).toBe("fixture.Robot");
    expect(Swift.typeName(o.$type.metadata)).toBe("fixture.Robot");
    expect(o.$handle.isNull()).toBe(false);
  });

  test("$kind tags the facade as an object instance", () => {
    expect(robot("R2").$kind).toBe("object");
  });

  test("equals compares identity; has reflects reserved + member names", () => {
    const o = robot("R2");
    expect(o.equals(Swift.Object(o.$handle))).toBe(true);
    expect(o.equals(robot("R2"))).toBe(false);
    expect("greet" in o).toBe(true);
    expect("$type" in o).toBe(true);
    expect("nope" in o).toBe(false);
  });

  test("toString renders type and address", () => {
    const o = robot("R2");
    expect(o.toString()).toBe(`<fixture.Robot: ${o.$handle}>`);
  });

  test("ownKeys enumerates methods and properties consistently with has", () => {
    const keys = Object.keys(robot("R2"));
    expect(keys).toContain("greet"); // method
    expect(keys).toContain("badge"); // property, formerly absent from ownKeys
    for (const k of keys) {
      expect(k in robot("R2")).toBe(true);
    }
  });

  test("use after $dispose throws; $dispose is idempotent; toJSON degrades", () => {
    const o = robot("R2");
    o.$dispose();
    o.$dispose();
    expect(() => o.$fields).toThrow();
    expect(() => o.$field("name")).toThrow();
    expect(() => o.$type).toThrow();
    expect(() => o.greet("Alice")).toThrow();
    expect(o.toJSON()).toEqual({ kind: "object", handle: o.$handle.toString(), disposed: true });
  });
});

function clash(handle: number) {
  return (Swift.typeOf(Swift.metadataFor("fixture.Clash")!) as ClassType).init(handle);
}

describe("Swift.Object collision-proofing", () => {
  beforeEach(() => { loadFixture(); });

  test("bare names reach Swift members that clash with the facade's raw spellings", () => {
    const c = clash(7);
    expect(c.handle).toEqual(int64(7));      // stored property, not the native pointer
    expect(c.get()).toBe("got 7"); // method named get, not a property reader
    expect(c.call()).toEqual(int64(14));     // method named call, not the bridge invoker
    expect(c.field()).toEqual(int64(107));   // method named field, not the bridge field accessor
  });

  test("$-prefixed intrinsics stay available alongside the clashing members", () => {
    const c = clash(7);
    expect(c.$handle.isNull()).toBe(false);
    expect(c.$get("handle")).toEqual(int64(7));
    expect(c.$call("get")).toBe("got 7");
    expect(c.$field("handle").read()).toEqual(int64(7));
  });

  test("raw spellings are not leaked when no Swift member shadows them", () => {
    const o = robot("R2") as unknown as Record<string, unknown>;
    expect(o.handle).toBeUndefined();
    expect(o.get).toBeUndefined();
    expect(o.call).toBeUndefined();
    expect(o.field).toBeUndefined();
  });
});
