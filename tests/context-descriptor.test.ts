import { test, expect, describe } from "@frida/injest/agent";

import { enumerateTypeContextDescriptors } from "../src/macho/sections.js";
import {
  ContextDescriptor,
  ContextDescriptorKind,
} from "../src/abi/context-descriptor.js";

function loadSwiftCore(skip: (reason?: string) => void): Module {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  return Process.findModuleByName("libswiftCore.dylib") ?? Module.load("libswiftCore.dylib");
}

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
  test("reads kind, module and qualified name of a stdlib struct", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const int = indexByName(lib).get("Int");
    expect(int).toBeDefined();
    expect(int!.kind).toBe(ContextDescriptorKind.Struct);
    expect(int!.isType).toBeTruthy();
    expect(int!.isGeneric).toBeFalsy();
    expect(int!.moduleName).toBe("Swift");
    expect(int!.fullTypeName).toBe("Swift.Int");
  });

  test("discriminates a generic enum", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const optional = indexByName(lib).get("Optional");
    expect(optional).toBeDefined();
    expect(optional!.kind).toBe(ContextDescriptorKind.Enum);
    expect(optional!.isGeneric).toBeTruthy();
    expect(optional!.fullTypeName).toBe("Swift.Optional");
  });

  test("exposes a metadata access function for a non-generic type", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const int = indexByName(lib).get("Int")!;
    const accessFn = int.accessFunction;
    expect(accessFn).not.toBeNull();
    expect(accessFn!.compare(lib.base) >= 0).toBeTruthy();
  });

  test("sees both struct and enum kinds across libswiftCore", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const kinds = new Set<ContextDescriptorKind>();
    for (const ptr of enumerateTypeContextDescriptors(lib)) {
      kinds.add(new ContextDescriptor(ptr).kind);
    }
    expect(kinds.has(ContextDescriptorKind.Struct)).toBeTruthy();
    expect(kinds.has(ContextDescriptorKind.Enum)).toBeTruthy();
  });
});
