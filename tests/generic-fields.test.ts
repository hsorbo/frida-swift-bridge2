import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { enumerateFields, fieldTypeIn } from "../src/abi/field-descriptor.js";

describe("generic field resolution", () => {
  test("instantiated metadata exposes its nominal descriptor", () => {
    requireSwift();
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!])!;
    expect(arrayInt.description.handle.equals(findType("Swift.Array")!.handle)).toBeTruthy();
  });

  test("resolves a field referencing the generic parameter via the argument vector", () => {
    requireSwift();
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!])!;
    const fields = [...enumerateFields(arrayInt.description)];
    expect(fields.length).toBeGreaterThan(0);
    const bufferType = fieldTypeIn(arrayInt, fields[0]);
    expect(bufferType).not.toBeNull();
    expect(bufferType!.kind).toBe(MetadataKind.Struct);
  });

  test("distinct element types yield distinct field metadata", () => {
    requireSwift();
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
