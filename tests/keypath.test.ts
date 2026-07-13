import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { fixtureExport, loadFixture } from "./fixtures/load.js";
import { readKeyPathBuffer, resolveKeyPathNames } from "../src/abi/keypath.js";
import type { StoredKeyPathComponent, ComputedKeyPathComponent } from "../src/abi/keypath.js";
import { typeName } from "../src/runtime/type-name.js";
import { Swift } from "../src/index.js";

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
    // isSingleComponent is a Swift 6.2+ runtime optimization flag, unset before it; components.length is the real measure.
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

describe("resolveKeyPathNames", () => {
  beforeEach(() => {
    requireSwift();
    loadFixture();
  });

  test("names a stored struct component by byte offset", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathPointX"));
    const names = resolveKeyPathNames(buffer.components, Swift.metadataFor("fixture.Point")!);
    expect(names).toEqual(["x"]);
  });

  test("names a stored class component by byte offset", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathGadgetValue"));
    const names = resolveKeyPathNames(buffer.components, Swift.metadataFor("fixture.Gadget")!);
    expect(names).toEqual(["value"]);
  });

  test("names every step of a multi-component path across the inter-component type", () => {
    const buffer = readKeyPathBuffer(keyPath("keyPathLineEndX"));
    const names = resolveKeyPathNames(buffer.components, Swift.metadataFor("fixture.Line")!);
    expect(names).toEqual(["end", "x"]);
  });

  test("leaves a plain-getter computed component unnamed", () => {
    const doubled = readKeyPathBuffer(keyPath("keyPathPointDoubled"));
    expect(resolveKeyPathNames(doubled.components, Swift.metadataFor("fixture.Point")!)).toEqual([null]);

    const scaled = readKeyPathBuffer(keyPath("keyPathRectScaled"));
    expect(resolveKeyPathNames(scaled.components, Swift.metadataFor("fixture.Rect")!)).toEqual([null]);
  });

  test("names a reabstracted stored property via its storedPropertyIndex id", () => {
    const root = Swift.metadataFor("fixture.Handler")!;

    const action = readKeyPathBuffer(keyPath("keyPathHandlerAction"));
    expect((action.components[0] as ComputedKeyPathComponent).idKind).toBe("storedPropertyIndex");
    expect(resolveKeyPathNames(action.components, root)).toEqual(["action"]);

    const label = readKeyPathBuffer(keyPath("keyPathHandlerLabel"));
    expect((label.components[0] as StoredKeyPathComponent).kind).toBe("struct");
    expect(resolveKeyPathNames(label.components, root)).toEqual(["label"]);
  });

  test("names a reabstracted stored property on a class via its storedPropertyIndex id", () => {
    const onEvent = readKeyPathBuffer(keyPath("keyPathSinkOnEvent"));
    expect((onEvent.components[0] as ComputedKeyPathComponent).idKind).toBe("storedPropertyIndex");
    expect(resolveKeyPathNames(onEvent.components, Swift.metadataFor("fixture.Sink")!)).toEqual([
      "onEvent",
    ]);
  });
});
