import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { getGenericMetadata, MetadataKind } from "../src/abi/metadata.js";

describe("generic metadata", () => {
  test("instantiates Array<Int> through the generic accessor", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const arrayInt = Swift.metadataFor("Swift.Array", [int])!;
    expect(arrayInt.kind).toBe(MetadataKind.Struct);
    expect(arrayInt.typeLayout.size).toBe(Process.pointerSize);
  });

  test("instantiates Optional<Int> as a value type", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const optionalInt = Swift.metadataFor("Swift.Optional", [int])!;
    expect(optionalInt.kind).toBe(MetadataKind.Optional);
  });

  test("distinct type arguments yield distinct, cached metadata", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const string = Swift.metadataFor("Swift.String")!;
    const arrayInt = Swift.metadataFor("Swift.Array", [int])!;
    const arrayIntAgain = Swift.metadataFor("Swift.Array", [int])!;
    const arrayString = Swift.metadataFor("Swift.Array", [string])!;
    expect(arrayInt.handle.equals(arrayIntAgain.handle)).toBeTruthy();
    expect(arrayInt.handle.equals(arrayString.handle)).toBeFalsy();
  });

  test("nests generic instantiations (Array<Array<Int>>)", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const arrayInt = Swift.metadataFor("Swift.Array", [int])!;
    const nested = Swift.metadataFor("Swift.Array", [arrayInt])!;
    expect(nested.kind).toBe(MetadataKind.Struct);
    expect(nested.handle.equals(arrayInt.handle)).toBeFalsy();
  });

  test("rejects a wrong number of type arguments", ({ skip }) => {
    requireSwift(skip);
    const array = findType("Swift.Array")!;
    expect(() => getGenericMetadata(array, [])).toThrow();
  });

  test("rejects generics with conformance requirements", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const string = Swift.metadataFor("Swift.String")!;
    const dictionary = findType("Swift.Dictionary")!;
    expect(() => getGenericMetadata(dictionary, [string, int])).toThrow();
  });
});
