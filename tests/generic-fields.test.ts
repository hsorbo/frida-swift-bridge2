import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { enumerateFields, fieldTypeIn } from "../src/abi/field-descriptor.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

describe("generic field resolution", () => {
  test("instantiated metadata exposes its nominal descriptor", ({ skip }) => {
    requireSwift(skip);
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!])!;
    expect(arrayInt.description.handle.equals(findType("Swift.Array")!.handle)).toBeTruthy();
  });

  test("resolves a field referencing the generic parameter via the argument vector", ({ skip }) => {
    requireSwift(skip);
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!])!;
    const fields = [...enumerateFields(arrayInt.description)];
    expect(fields.length).toBeGreaterThan(0);
    const bufferType = fieldTypeIn(arrayInt, fields[0]);
    expect(bufferType).not.toBeNull();
    expect(bufferType!.kind).toBe(MetadataKind.Struct);
  });

  test("distinct element types yield distinct field metadata", ({ skip }) => {
    requireSwift(skip);
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!])!;
    const arrayString = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.String")!])!;
    const field = [...enumerateFields(arrayInt.description)][0];
    const intBuffer = fieldTypeIn(arrayInt, field);
    const stringBuffer = fieldTypeIn(arrayString, field);
    expect(intBuffer).not.toBeNull();
    expect(stringBuffer).not.toBeNull();
    expect(intBuffer!.handle.equals(stringBuffer!.handle)).toBeFalsy();
  });
});
