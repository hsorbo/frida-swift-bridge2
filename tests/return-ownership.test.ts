import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Value,
  HeapObject,
  ClassType,
  StructType,
  embedsManagedReference,
} from "../src/index.js";

function metadataFor(name: string) {
  return Swift.metadataFor(name)!;
}

describe("value return embedding a class ref", () => {
  test("embedsManagedReference distinguishes a borrowed ref from a deep-copied field", ({ skip }) => {
    loadFixture(skip);
    expect(embedsManagedReference(metadataFor("fixture.Token"))).toBe(true);
    expect(embedsManagedReference(metadataFor("fixture.Wrapper"))).toBe(true);
    expect(embedsManagedReference(metadataFor("fixture.LoadableStruct"))).toBe(false);
    expect(embedsManagedReference(metadataFor("fixture.PoliteGreeter"))).toBe(false);
    // Array/Set/Dictionary: a Builtin.BridgeObject (Opaque) backing, not a class ref.
    const Int = metadataFor("Swift.Int");
    expect(embedsManagedReference(Swift.metadataFor("Swift.Array", [Int])!)).toBe(true);
    expect(embedsManagedReference(Swift.metadataFor("Swift.Set", [Int])!)).toBe(true);
    expect(embedsManagedReference(Swift.metadataFor("Swift.Dictionary", [Int, Int])!)).toBe(true);
  });

  test("a returned aggregate owns its embedded class ref and releases it on dispose", ({ skip }) => {
    loadFixture(skip);
    const token = (Swift.typeOf(metadataFor("fixture.Token")) as ClassType).init(7);
    const view = new HeapObject(token.handle);
    const before = view.retainCount;

    const wrapper = (Swift.typeOf(metadataFor("fixture.Wrapper")) as StructType).call("make", token.handle);
    expect(wrapper instanceof Value).toBe(true);

    const owned = wrapper as Value;
    expect(owned.owned).toBe(true);
    expect(view.retainCount).toBe(before + 1); // the returned +1 is held, not dangling

    const embedded = owned.field("token").get() as NativePointer;
    expect(embedded.equals(token.handle)).toBe(true);
    expect(view.retainCount).toBe(before + 1); // reading the field is borrowing, not retaining

    owned.dispose();
    expect(view.retainCount).toBe(before); // disposing the aggregate releases the embedded ref
  });
});

describe("bridge-object container return", () => {
  test("a returned Array is adopted as an owned Value, not decoded lossily", ({ skip }) => {
    loadFixture(skip);
    const arr = (Swift.typeOf(metadataFor("fixture.Bag")) as StructType).call("ints");
    expect(arr instanceof Value).toBe(true);

    const owned = arr as Value;
    expect(owned.owned).toBe(true);

    // +1 buffer survived a premature destroy: it sums back through a [Int] param.
    const box = Swift.typeOf(metadataFor("fixture.Box")) as ClassType;
    expect(box.init().method("sumInts").call(owned)).toBe(60);

    owned.dispose();
  });
});
