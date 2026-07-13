import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { fixtureExport, loadFixture } from "./fixtures/load.js";
import { readKeyPathBuffer } from "../src/abi/keypath.js";
import type { StoredKeyPathComponent, ComputedKeyPathComponent } from "../src/abi/keypath.js";
import { typeName } from "../src/runtime/type-name.js";

function keyPath(accessor: string): NativePointer {
  return new NativeFunction(fixtureExport(accessor), "pointer", [])() as NativePointer;
}

describe("readKeyPathBuffer", () => {
  beforeEach(() => {
    requireSwift();
    loadFixture();
  });

  test("reads a single stored-struct component with an inline offset", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathPointX"));
    expect(buffer.trivial).toBe(true);
    expect(buffer.isSingleComponent).toBe(true);
    expect(buffer.hasReferencePrefix).toBe(false);
    expect(buffer.components.length).toBe(1);

    const component = buffer.components[0] as StoredKeyPathComponent;
    expect(component.kind).toBe("struct");
    expect(component.offset).toBe(0);
    expect(component.mutable).toBe(true);
    expect(component.nextType).toBeNull();
  });

  test("reads a get-only computed component", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathPointDoubled"));
    expect(buffer.isSingleComponent).toBe(true);
    expect(buffer.components.length).toBe(1);

    const component = buffer.components[0] as ComputedKeyPathComponent;
    expect(component.kind).toBe("computed");
    expect(component.settable).toBe(false);
    expect(component.mutating).toBe(false);
    expect(component.idKind).toBe("pointer");
    expect(component.idResolution).toBe("resolved");
    expect(component.getter.isNull()).toBe(false);
    expect(component.setter).toBeNull();
    expect(component.arguments).toBeNull();
  });

  test("reads a settable, mutating computed component with a setter", () => {
    const component = readKeyPathBuffer(keyPath("keyPathRectScaled"))
      .components[0] as ComputedKeyPathComponent;
    expect(component.kind).toBe("computed");
    expect(component.settable).toBe(true);
    expect(component.mutating).toBe(true);
    expect(component.getter.isNull()).toBe(false);
    expect(component.setter).not.toBeNull();
    expect(component.setter!.isNull()).toBe(false);
    expect(component.getter.equals(component.setter!)).toBe(false);
  });

  test("reads a stored-class component with the field byte offset", () => {
    const component = readKeyPathBuffer(keyPath("keyPathGadgetValue"))
      .components[0] as StoredKeyPathComponent;
    expect(component.kind).toBe("class");
    expect(component.offset).toBe(Process.pointerSize * 2);
    expect(component.mutable).toBe(true);
  });

  test("walks a two-component path across the inter-component type pointer", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathLineEndX"));
    expect(buffer.isSingleComponent).toBe(false);
    expect(buffer.components.length).toBe(2);

    const first = buffer.components[0] as StoredKeyPathComponent;
    expect(first.kind).toBe("struct");
    expect(first.offset).toBe(Process.pointerSize);
    expect(first.nextType).not.toBeNull();
    expect(typeName(first.nextType!)).toBe("fixture.Point");

    const second = buffer.components[1] as StoredKeyPathComponent;
    expect(second.kind).toBe("struct");
    expect(second.offset).toBe(0);
    expect(second.nextType).toBeNull();
  });
});
