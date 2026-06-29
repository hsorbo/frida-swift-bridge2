import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, Metadata, MethodDescriptorKind, readVTable } from "../src/index.js";
import { resolveMethod } from "../src/runtime/method.js";

function dispatcherType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Dispatcher")!) as ClassType;
}

function Int(): Metadata {
  return Swift.metadataFor("Swift.Int")!;
}

function instanceMethods(type: ClassType) {
  return type.vtable.filter((e) => e.kind === MethodDescriptorKind.Method && e.isInstance);
}

describe("vtable route", () => {
  test("enumerates instance-method slots, including the non-exported one", () => {
    loadFixture();
    expect(instanceMethods(dispatcherType()).length).toBe(2);
  });

  test("the non-exported method is invisible to the symbol route", () => {
    const mod = loadFixture();
    const exportsMethod = (name: string): boolean =>
      [...mod.enumerateExports()].some((e) => {
        const d = Swift.demangle(e.name);
        return d !== null && d.includes(`fixture.Dispatcher.${name}`);
      });
    expect(exportsMethod("pub")).toBe(true); // same matcher finds pub, so hidden's absence is real
    expect(exportsMethod("hidden")).toBe(false);
  });

  test("invokes each slot by offset, reaching the non-exported impl", () => {
    loadFixture();
    const type = dispatcherType();
    const obj = type.init();
    const results = instanceMethods(type)
      .map((e) => obj.vtableMethod(e.metadataOffset, { returnType: Int(), argTypes: [Int()] }).call(10) as number)
      .sort((a, b) => a - b);
    expect(results).toEqual([11, 30]); // pub(10)=11, hidden(10)=30
  });

  test("the exported slot's impl matches the symbol route", () => {
    loadFixture();
    const type = dispatcherType();
    const obj = type.init();
    const pub = instanceMethods(type).find(
      (e) => obj.vtableMethod(e.metadataOffset, { returnType: Int(), argTypes: [Int()] }).call(10) === 11
    )!;
    const viaSymbol = resolveMethod("fixture.Dispatcher", "pub", { static: false });
    expect(pub.declaredImpl.equals(viaSymbol.address)).toBe(true);
  });

  test("throws for a class whose vtable offset is not fixed", () => {
    loadFixture();
    expect(() => readVTable(Swift.findType("fixture.GenericHolder")!)).toThrow(/generic/);
  });
});
