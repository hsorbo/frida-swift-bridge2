import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, loadFixtureSyms } from "./fixtures/load.js";

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
function wrapperOverToken(module = "fixture"): { wrapper: SwiftObject; view: ClassInstance } {
  const token = (Swift.typeOf(Swift.metadataFor(`${module}.Token`)!) as ClassType).init(7) as SwiftObject;
  const wrapper = (Swift.typeOf(Swift.metadataFor(`${module}.Wrapper`)!) as StructType).call(
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

// Value initializers resolve only through the symbol table, so use the unstripped fixturesyms twin.
describe("value-initializer ownership", () => {
  beforeEach(() => {
    loadFixtureSyms();
  });

  test("a failed later arg does not leak the non-POD prefix temp", () => {
    const { wrapper, view } = wrapperOverToken("fixturesyms");
    const Keeper = Swift.typeOf(Swift.metadataFor("fixturesyms.Keeper")!) as StructType;
    const before = view.retainCount;
    expect(() => Keeper.initializer().call(wrapper, "bad" as never)).toThrow();
    expect(view.retainCount).toBe(before);
  });

  test("a consumed class argument is retained, so the caller's object survives the init", () => {
    const token = (Swift.typeOf(Swift.metadataFor("fixturesyms.Token")!) as ClassType).init(7) as SwiftObject;
    const view = new ClassInstance(token.$handle);
    const before = view.retainCount;
    const box = (Swift.typeOf(Swift.metadataFor("fixturesyms.TokenBox")!) as StructType)
      .initializer()
      .call(token, 5) as SwiftObject;
    // The box owns its own +1 on the token; the caller's reference is untouched.
    expect(view.retainCount).toBe(before + 1);
    expect(token.$field("id").read()).toEqual(int64(7));
    box.$dispose();
    expect(view.retainCount).toBe(before);
    expect(token.$field("id").read()).toEqual(int64(7));
  });
});

describe("class-boundary ownership (init and property setter)", () => {
  beforeEach(() => {
    loadFixture();
  });

  function kennelType(): ClassType {
    return Swift.typeOf(Swift.metadataFor("fixture.Kennel")!) as ClassType;
  }
  function token(id: number): { facade: SwiftObject; view: ClassInstance } {
    const facade = (Swift.typeOf(Swift.metadataFor("fixture.Token")!) as ClassType).init(id) as SwiftObject;
    return { facade, view: new ClassInstance(facade.$handle) };
  }

  test("class init gives the callee its own +1 on a class argument", () => {
    const { wrapper } = wrapperOverToken();
    const occupant = token(1);
    const before = occupant.view.retainCount;
    const kennel = kennelType().init(wrapper, occupant.facade);
    expect(occupant.view.retainCount).toBe(before + 1);
    expect(kennel.occupant.id).toEqual(int64(1));
  });

  test("class init failure destroys the non-POD prefix temp", () => {
    const { wrapper, view } = wrapperOverToken();
    const before = view.retainCount;
    expect(() => kennelType().init(wrapper, "bad" as never)).toThrow();
    expect(view.retainCount).toBe(before);
  });

  test("a class-valued setter consumes its own +1, not the caller's reference", () => {
    const { wrapper } = wrapperOverToken();
    const first = token(1);
    const kennel = kennelType().init(wrapper, first.facade);
    const next = token(2);
    const beforeNext = next.view.retainCount;
    const beforeFirst = first.view.retainCount;
    kennel.$set("occupant", next.facade);
    expect(next.view.retainCount).toBe(beforeNext + 1);
    expect(beforeFirst - first.view.retainCount).toBe(1);
    expect(next.facade.id).toEqual(int64(2));
  });
});
