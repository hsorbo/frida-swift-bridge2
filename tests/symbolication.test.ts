import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import {
  parseSwiftSignature,
  symbolicate,
  resolveFunctionSignature,
  resolveType,
  type SwiftFunctionSignature,
  type SwiftAccessorSignature,
} from "../src/runtime/symbolication.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureSymbol(skip: Skip, swiftName: string): { address: NativePointer; demangled: string } {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return { address: e.address, demangled };
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

describe("parseSwiftSignature", () => {
  test("parses a free function with positional args", () => {
    const s = parseSwiftSignature("fixture.addInts(Swift.Int, Swift.Int) -> Swift.Int") as SwiftFunctionSignature;
    expect(s.kind).toBe("function");
    expect(s.context).toBe("fixture");
    expect(s.name).toBe("addInts");
    expect(s.throws).toBe(false);
    expect(s.argTypeNames).toEqual(["Swift.Int", "Swift.Int"]);
    expect(s.returnTypeName).toBe("Swift.Int");
  });

  test("parses a method with labeled args and a nominal return type", () => {
    const s = parseSwiftSignature(
      "fixture.Point.translated(dx: Swift.Int, dy: Swift.Int) -> fixture.Point"
    ) as SwiftFunctionSignature;
    expect(s.context).toBe("fixture.Point");
    expect(s.name).toBe("translated");
    expect(s.argTypeNames).toEqual(["Swift.Int", "Swift.Int"]);
    expect(s.returnTypeName).toBe("fixture.Point");
  });

  test("flags a throwing function", () => {
    const s = parseSwiftSignature("fixture.mightThrow(Swift.Int) throws -> Swift.Int") as SwiftFunctionSignature;
    expect(s.throws).toBe(true);
    expect(s.argTypeNames).toEqual(["Swift.Int"]);
    expect(s.returnTypeName).toBe("Swift.Int");
  });

  test("treats an empty arg list and a () return as no args / void", () => {
    const s = parseSwiftSignature("fixture.noArgs() -> ()") as SwiftFunctionSignature;
    expect(s.argTypeNames).toEqual([]);
    expect(s.returnTypeName).toBeNull();
  });

  test("does not split commas nested in generics or tuples", () => {
    const s = parseSwiftSignature(
      "m.f(Swift.Dictionary<Swift.Int, Swift.String>, (Swift.Int, Swift.Int)) -> Swift.Bool"
    ) as SwiftFunctionSignature;
    expect(s.argTypeNames).toEqual([
      "Swift.Dictionary<Swift.Int, Swift.String>",
      "(Swift.Int, Swift.Int)",
    ]);
  });

  test("parses a property accessor", () => {
    const s = parseSwiftSignature("fixture.Point.doubled.getter : Swift.Int") as SwiftAccessorSignature;
    expect(s.kind).toBe("getter");
    expect(s.context).toBe("fixture.Point");
    expect(s.member).toBe("doubled");
    expect(s.typeName).toBe("Swift.Int");
  });
});

describe("symbolicate", () => {
  test("recovers the mangled and demangled name of a function address", ({ skip }) => {
    const { address } = fixtureSymbol(skip, "fixture.addInts");
    const sym = symbolicate(address)!;
    expect(sym.name.includes("addInts")).toBe(true);
    expect(sym.demangled.startsWith("fixture.addInts(")).toBe(true);
  });

  test("returns null for an address with no owning module", () => {
    expect(symbolicate(ptr(1))).toBeNull();
  });
});

describe("resolveFunctionSignature", () => {
  test("resolves arg and return type names to metadata", ({ skip }) => {
    const { demangled } = fixtureSymbol(skip, "fixture.combine");
    const resolved = resolveFunctionSignature(parseSwiftSignature(demangled) as SwiftFunctionSignature)!;
    expect(resolved.throws).toBe(false);
    expect(Swift.typeName(resolved.argTypes[0])).toBe("Swift.Int");
    expect(Swift.typeName(resolved.argTypes[1])).toBe("Swift.Double");
    expect(Swift.typeName(resolved.returnType!)).toBe("Swift.Double");
  });

  test("drives makeSwiftNativeFunction straight from a symbol", ({ skip }) => {
    const { address, demangled } = fixtureSymbol(skip, "fixture.addInts");
    const { argTypes, returnType } = resolveFunctionSignature(
      parseSwiftSignature(demangled) as SwiftFunctionSignature
    )!;
    const add = makeSwiftNativeFunction(address, returnType, argTypes);
    const a = Memory.alloc(8);
    a.writeU64(20);
    const b = Memory.alloc(8);
    b.writeU64(22);
    expect(add(a, b)!.readU64().toNumber()).toBe(42);
  });

  test("resolves a property accessor's member type", ({ skip }) => {
    const { demangled } = fixtureSymbol(skip, "fixture.Point.doubled.getter");
    const sig = parseSwiftSignature(demangled) as SwiftAccessorSignature;
    expect(sig.kind).toBe("getter");
    expect(Swift.typeName(resolveType(sig.typeName)!)).toBe("Swift.Int");
  });
});
