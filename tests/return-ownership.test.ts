import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Value,
  HeapObject,
  ClassType,
  StructType,
  containsClassReference,
} from "../src/index.js";

function metadataFor(name: string) {
  return Swift.metadataFor(name)!;
}

describe("value return embedding a class ref", () => {
  test("containsClassReference distinguishes a borrowed ref from a deep-copied field", ({ skip }) => {
    loadFixture(skip);
    expect(containsClassReference(metadataFor("fixture.Token"))).toBe(true);
    expect(containsClassReference(metadataFor("fixture.Wrapper"))).toBe(true);
    expect(containsClassReference(metadataFor("fixture.LoadableStruct"))).toBe(false);
    expect(containsClassReference(metadataFor("fixture.PoliteGreeter"))).toBe(false);
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
