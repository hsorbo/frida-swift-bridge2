import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import {
  enumerateSwiftModules,
  enumerateTypes,
  findType,
} from "../src/reflection/registry.js";
import { ContextDescriptorKind } from "../src/abi/context-descriptor.js";

describe("registry", () => {
  test("discovers libswiftCore as a Swift-bearing module", ({ skip }) => {
    requireSwift(skip);
    const names = new Set([...enumerateSwiftModules()].map((m) => m.name));
    expect(names.has("libswiftCore.dylib")).toBeTruthy();
  });

  test("enumerated types are all type-kind descriptors", ({ skip }) => {
    requireSwift(skip);
    const lib = Process.getModuleByName("libswiftCore.dylib");
    let count = 0;
    for (const descriptor of enumerateTypes(lib)) {
      expect(descriptor.isType).toBeTruthy();
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test("finds a type by qualified name", ({ skip }) => {
    requireSwift(skip);
    const int = findType("Swift.Int");
    expect(int).not.toBeNull();
    expect(int!.kind).toBe(ContextDescriptorKind.Struct);
    expect(int!.fullTypeName).toBe("Swift.Int");
  });

  test("finds a type by simple name", ({ skip }) => {
    requireSwift(skip);
    const optional = findType("Optional");
    expect(optional).not.toBeNull();
    expect(optional!.kind).toBe(ContextDescriptorKind.Enum);
  });

  test("returns null for an unknown type", ({ skip }) => {
    requireSwift(skip);
    expect(findType("Swift.NoSuchTypeQX")).toBeNull();
  });

  test("repeated lookups are cached to the same descriptor", ({ skip }) => {
    requireSwift(skip);
    const first = findType("Swift.Int")!;
    const second = findType("Swift.Int")!;
    expect(first.handle.equals(second.handle)).toBeTruthy();
  });

  test("Swift.findType exposes the registry", ({ skip }) => {
    requireSwift(skip);
    expect(Swift.findType("Swift.String")).not.toBeNull();
  });
});
