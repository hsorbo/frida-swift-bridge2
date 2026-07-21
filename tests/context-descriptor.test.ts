import { test, expect, describe } from "@frida/injest/agent";
import { loadSwiftCore } from "./swift.js";

import { enumerateTypeContextDescriptors } from "../src/image/sections.js";
import {
  ContextDescriptor,
  ContextDescriptorKind,
} from "../src/abi/context-descriptor.js";

import { Swift } from "../src/index.js";
function indexByName(lib: Module): Map<string, ContextDescriptor> {
  const byName = new Map<string, ContextDescriptor>();
  for (const ptr of enumerateTypeContextDescriptors(lib)) {
    const descriptor = new ContextDescriptor(ptr);
    const name = descriptor.name;
    if (name !== null && !byName.has(name)) {
      byName.set(name, descriptor);
    }
  }
  return byName;
}

describe("context descriptor", () => {
  test("reads kind, module and qualified name of a stdlib struct", () => {
    const lib = loadSwiftCore();
    const int = indexByName(lib).get("Int");
    expect(int).toBeDefined();
    expect(int!.kind).toBe(ContextDescriptorKind.Struct);
    expect(int!.isType).toBeTruthy();
    expect(int!.isGeneric).toBeFalsy();
    expect(int!.moduleName).toBe("Swift");
    expect(int!.fullTypeName).toBe("Swift.Int");
  });

  test("discriminates a generic enum", () => {
    const lib = loadSwiftCore();
    const optional = indexByName(lib).get("Optional");
    expect(optional).toBeDefined();
    expect(optional!.kind).toBe(ContextDescriptorKind.Enum);
    expect(optional!.isGeneric).toBeTruthy();
    expect(optional!.fullTypeName).toBe("Swift.Optional");
  });

  test("exposes a metadata access function for a non-generic type", () => {
    const lib = loadSwiftCore();
    const int = indexByName(lib).get("Int")!;
    const accessFn = int.accessFunction;
    expect(accessFn).not.toBeNull();
    expect(accessFn!.compare(lib.base) >= 0).toBeTruthy();
  });

  test("sees both struct and enum kinds across libswiftCore", () => {
    const lib = loadSwiftCore();
    const kinds = new Set<ContextDescriptorKind>();
    for (const ptr of enumerateTypeContextDescriptors(lib)) {
      kinds.add(new ContextDescriptor(ptr).kind);
    }
    expect(kinds.has(ContextDescriptorKind.Struct)).toBeTruthy();
    expect(kinds.has(ContextDescriptorKind.Enum)).toBeTruthy();
  });
});
