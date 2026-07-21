import { test, expect, describe } from "@frida/injest/agent";
import { fixtureExport } from "./fixtures/load.js";

import { ClassInstance, dynamicTypeOf, metadataFor, typeName } from "../src/abi.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

describe("dynamic type recovery", () => {
  test("recovers the most-derived type from a base-typed reference", () => {
    const Base = metadataFor("fixture.Base")!;
    const Derived = metadataFor("fixture.Derived")!;
    const make = makeSwiftNativeFunction(fixtureExport("fixture.makeDerivedAsBase"), Base, []);
    const ref = make()!.readPointer();

    const dynamic = dynamicTypeOf(ref);
    expect(dynamic.handle.equals(Derived.handle)).toBe(true);
    expect(typeName(dynamic)).toBe("fixture.Derived");
    expect(new ClassInstance(ref).dynamicType.handle.equals(Derived.handle)).toBe(true);
  });
});
