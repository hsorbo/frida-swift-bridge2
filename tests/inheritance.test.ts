import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, Metadata, MethodDescriptorKind, VTableEntry } from "../src/index.js";
import { resolveMethod, enumerateMethods } from "../src/runtime/method.js";

function animalType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Animal")!) as ClassType;
}

function catType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Cat")!) as ClassType;
}

function Int(): Metadata {
  return Swift.metadataFor("Swift.Int")!;
}

describe("inherited methods (symbol route)", () => {
  beforeEach(() => { loadFixture(); });

  test("calls a method inherited from the superclass", () => {
    expect(catType().init().$call("legs")).toBe(4); // Cat has no legs symbol; declared on Animal
  });

  test("resolveMethod finds the inherited impl declared on the superclass", () => {
    const onCat = resolveMethod("fixture.Cat", "legs", { static: false });
    const onAnimal = resolveMethod("fixture.Animal", "legs", { static: false });
    expect(onCat.address.equals(onAnimal.address)).toBe(true);
  });

  test("enumerateMethods unions the chain and dedups the override", () => {
    const selectors = enumerateMethods("fixture.Cat").map((m) => m.selector);
    expect(selectors).toContain("legs()"); // inherited
    expect(selectors).toContain("speak()"); // overridden
    expect(selectors.filter((s) => s === "speak()").length).toBe(1); // most-derived only
  });

  test("the facade exposes inherited methods", () => {
    const cat = catType().init();
    expect(cat.$type.methods()).toContain("legs()");
    expect(cat.legs()).toBe(4);
  });
});

describe("live polymorphic dispatch (metadata vtable)", () => {
  beforeEach(() => { loadFixture(); });

  // The slot that Animal declares speak in; the same word in any subclass metadata holds its override.
  function speakSlot(): number {
    const impl = resolveMethod("fixture.Animal", "speak", { static: false }).address;
    return animalType().vtable.find((e) => e.declaredImpl.equals(impl))!.metadataOffset;
  }

  test("a base slot reaches the most-derived override", () => {
    const slot = speakSlot();
    expect(catType().init().$vtableMethod(slot, { returnType: Int(), argTypes: [] }).call()).toBe(9); // Cat.speak
    expect(animalType().init().$vtableMethod(slot, { returnType: Int(), argTypes: [] }).call()).toBe(1); // Animal.speak
  });

  test("the live impl differs from the descriptor's declared impl", () => {
    const declared = resolveMethod("fixture.Animal", "speak", { static: false }).address;
    const overridden = resolveMethod("fixture.Cat", "speak", { static: false }).address;
    const slot = speakSlot();
    const live = catType().init().$vtableMethod(slot, { returnType: Int(), argTypes: [] }).address;
    expect(live.equals(overridden)).toBe(true);
    expect(live.equals(declared)).toBe(false);
  });

  test("the subclass vtable surfaces inherited slots", () => {
    const instanceMethods = catType()
      .init()
      .$vtable.filter((e: VTableEntry) => e.kind === MethodDescriptorKind.Method && e.isInstance);
    expect(instanceMethods.length).toBe(2); // speak + legs, both from Animal's descriptor
  });
});
