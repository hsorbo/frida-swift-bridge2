import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift, SWIFTCORE_MODULE } from "./swift.js";
import { loadResilient, RESILIENT_MODULE } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import {
  enumerateSwiftModules,
  enumerateTypes,
  findType,
} from "../src/reflection/registry.js";
import { ContextDescriptorKind } from "../src/abi/context-descriptor.js";

describe("registry", () => {
  test("discovers libswiftCore as a Swift-bearing module", () => {
    requireSwift();
    const names = new Set([...enumerateSwiftModules()].map((m) => m.name));
    expect(names.has(SWIFTCORE_MODULE)).toBeTruthy();
  });

  test("discovers a module loaded at runtime", () => {
    loadResilient();
    const names = new Set([...enumerateSwiftModules()].map((m) => m.name));
    expect(names.has(RESILIENT_MODULE)).toBeTruthy();
    expect(findType("resilient.ResilientPoint")).not.toBeNull();
  });

  test("enumerated types are all type-kind descriptors", () => {
    requireSwift();
    const lib = Process.getModuleByName(SWIFTCORE_MODULE);
    let count = 0;
    for (const descriptor of enumerateTypes(lib)) {
      expect(descriptor.isType).toBeTruthy();
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test("finds a type by qualified name", () => {
    requireSwift();
    const int = findType("Swift.Int");
    expect(int).not.toBeNull();
    expect(int!.kind).toBe(ContextDescriptorKind.Struct);
    expect(int!.fullTypeName).toBe("Swift.Int");
  });

  test("finds a type by simple name", () => {
    requireSwift();
    const optional = findType("Optional");
    expect(optional).not.toBeNull();
    expect(optional!.kind).toBe(ContextDescriptorKind.Enum);
  });

  test("returns null for an unknown type", () => {
    requireSwift();
    expect(findType("Swift.NoSuchTypeQX")).toBeNull();
  });

  test("repeated lookups are cached to the same descriptor", () => {
    requireSwift();
    const first = findType("Swift.Int")!;
    const second = findType("Swift.Int")!;
    expect(first.handle.equals(second.handle)).toBeTruthy();
  });

  test("Swift.findType exposes the registry", () => {
    requireSwift();
    expect(Swift.findType("Swift.String")).not.toBeNull();
  });

  test("Swift.modules() yields Swift-bearing modules", () => {
    requireSwift();
    const names = new Set([...Swift.modules()].map((m) => m.name));
    expect(names.has(SWIFTCORE_MODULE)).toBeTruthy();
  });

  test("Swift.types(module) yields type-kind descriptors", () => {
    requireSwift();
    const lib = Process.getModuleByName(SWIFTCORE_MODULE);
    let count = 0;
    for (const descriptor of Swift.types(lib)) {
      expect(descriptor.isType).toBeTruthy();
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test("Swift.types() reflects modules loaded after first enumeration", () => {
    requireSwift();
    [...Swift.modules()];
    loadResilient();
    const names = new Set([...Swift.modules()].map((m) => m.name));
    expect(names.has(RESILIENT_MODULE)).toBeTruthy();
    const types = new Set([...Swift.types()].map((d) => d.fullTypeName));
    expect(types.has("resilient.ResilientPoint")).toBeTruthy();
  });

  test("Swift.types(module) is memoized to a stable parse", () => {
    requireSwift();
    const lib = Process.getModuleByName(SWIFTCORE_MODULE);
    const find = (name: string) =>
      [...Swift.types(lib)].find((d) => d.fullTypeName === name) ?? null;
    const first = find("Swift.Int");
    const second = find("Swift.Int");
    expect(first).not.toBeNull();
    expect(first!.handle.equals(second!.handle)).toBeTruthy();
  });
});
