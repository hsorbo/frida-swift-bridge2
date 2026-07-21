import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  ClassType,
  StructType,
  ClassInstance,
  BoundAsyncMethod,
  GenericBoundAsyncMethod,
  SwiftObject,
} from "../src/index.js";

// A Wrapper is non-POD (it embeds a Token class ref), so marshalling it +1s the embedded token. If a
// later argument fails to marshal, the copied Wrapper temp must be destroyed, releasing that token.
function wrapperOverToken(): { wrapper: SwiftObject; view: ClassInstance } {
  const token = (Swift.typeOf(Swift.metadataFor("fixture.Token")!) as ClassType).init(7) as SwiftObject;
  const wrapper = (Swift.typeOf(Swift.metadataFor("fixture.Wrapper")!) as StructType).call(
    "make",
    token.$handle
  ) as SwiftObject;
  return { wrapper, view: new ClassInstance(token.$handle) };
}

function boxType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Box")!) as ClassType;
}

describe("marshalling-failure cleanup across call paths", () => {
  beforeEach(() => {
    loadFixture();
  });

  test("sync generic: a failed later arg does not leak the non-POD prefix temp", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const { wrapper, view } = wrapperOverToken();
    const mix = boxType().init().$method("mix", { typeArguments: [Int] });
    const before = view.retainCount;
    expect(() => mix.call(wrapper, "bad" as never)).toThrow();
    expect(view.retainCount).toBe(before);
  });

  test("plain async: a failed later arg does not leak the non-POD prefix temp", () => {
    const { wrapper, view } = wrapperOverToken();
    const combine = boxType().init().$method("combineAsync") as BoundAsyncMethod;
    const before = view.retainCount;
    expect(() => combine.call(wrapper, "bad" as never)).toThrow();
    expect(view.retainCount).toBe(before);
  });

  test("generic async: a failed later arg does not leak the non-POD prefix temp", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const { wrapper, view } = wrapperOverToken();
    const mix = boxType().init().$method("mixAsync", { typeArguments: [Int] }) as GenericBoundAsyncMethod;
    const before = view.retainCount;
    expect(() => mix.call(wrapper, "bad" as never)).toThrow();
    expect(view.retainCount).toBe(before);
  });
});
