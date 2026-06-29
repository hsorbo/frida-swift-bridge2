import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassInstance, dynamicTypeOf } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureAddress(skip: Skip, swiftName: string): NativePointer {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

describe("dynamic type recovery", () => {
  test("recovers the most-derived type from a base-typed reference", ({ skip }) => {
    const Base = Swift.metadataFor("fixture.Base")!;
    const Derived = Swift.metadataFor("fixture.Derived")!;
    const make = makeSwiftNativeFunction(fixtureAddress(skip, "fixture.makeDerivedAsBase"), Base, []);
    const ref = make()!.readPointer();

    const dynamic = dynamicTypeOf(ref);
    expect(dynamic.handle.equals(Derived.handle)).toBe(true);
    expect(Swift.typeName(dynamic)).toBe("fixture.Derived");
    expect(new ClassInstance(ref).dynamicType.handle.equals(Derived.handle)).toBe(true);
  });
});
