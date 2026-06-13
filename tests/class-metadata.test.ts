import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { getClassMetadata, enumerateClassFields } from "../src/abi/class-metadata.js";

function classOrSkip(name: string, skip: (reason?: string) => void) {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
  const descriptor = findType(name);
  if (descriptor === null) {
    skip(`${name} not present in this stdlib`);
  }
  return descriptor!;
}

describe("class metadata", () => {
  test("reads instance size, superclass and field offsets", ({ skip }) => {
    const descriptor = classOrSkip("Swift.__RawSetStorage", skip);
    expect(descriptor.kind).toBe(ContextDescriptorKind.Class);
    expect(descriptor.isGeneric).toBeFalsy();

    const metadata = getClassMetadata(descriptor);
    expect(metadata.instanceSize).toBeGreaterThan(16);
    expect(metadata.superclass).not.toBeNull();

    const fields = [...enumerateClassFields(metadata)];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields[0].field.name).toBe("_count");
    expect(fields[0].offset).toBe(16); // past the 16-byte object header

    let previous = 0;
    for (const { offset } of fields) {
      expect(offset).toBeGreaterThanOrEqual(16);
      expect(offset).toBeLessThan(metadata.instanceSize);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
  });

  test("walks the superclass chain to a root", ({ skip }) => {
    const descriptor = classOrSkip("Swift.__RawSetStorage", skip);
    let current = getClassMetadata(descriptor).superclass;
    let depth = 0;
    while (current !== null && depth < 32) {
      current = current.superclass;
      depth++;
    }
    expect(current).toBeNull();
  });

  test("computes the same first-field offset for dictionary storage", ({ skip }) => {
    const descriptor = classOrSkip("Swift.__RawDictionaryStorage", skip);
    const fields = [...enumerateClassFields(getClassMetadata(descriptor))];
    expect(fields[0].field.name).toBe("_count");
    expect(fields[0].offset).toBe(16);
  });

  test("isTypeMetadata guards reading an ObjC superclass as Swift", ({ skip }) => {
    const descriptor = classOrSkip("Swift.__RawSetStorage", skip);
    const metadata = getClassMetadata(descriptor);
    expect(metadata.isTypeMetadata).toBeTruthy();

    let current = metadata.superclass;
    while (current !== null && current.isTypeMetadata) {
      current = current.superclass;
    }
    expect(current).not.toBeNull(); // an Objective-C ancestor exists in the chain
    expect(() => current!.description).toThrow();
  });
});
