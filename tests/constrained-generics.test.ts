import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind, instantiateGenericMetadata } from "../src/abi/metadata.js";
import { buildGenericMetadata } from "../src/abi/generic-instantiation.js";
import { findProtocol, conformsToProtocol } from "../src/abi/protocol-conformance.js";

describe("constrained generic auto-assembly", () => {
  test("Dictionary<String,Int> instantiates without supplying a witness table", () => {
    requireSwift();
    const dictionary = Swift.metadataFor("Swift.Dictionary", [
      Swift.metadataFor("Swift.String")!,
      Swift.metadataFor("Swift.Int")!,
    ]);
    expect(dictionary).not.toBeNull();
    expect(dictionary!.kind).toBe(MetadataKind.Struct);
    expect(dictionary!.description.handle.equals(findType("Swift.Dictionary")!.handle)).toBeTruthy();
  });

  test("Set<Int> resolves its Hashable requirement", () => {
    requireSwift();
    const set = Swift.metadataFor("Swift.Set", [Swift.metadataFor("Swift.Int")!]);
    expect(set).not.toBeNull();
    expect(set!.kind).toBe(MetadataKind.Struct);
  });

  test("auto-assembly matches a hand-built key-argument vector", () => {
    requireSwift();
    const string = Swift.metadataFor("Swift.String")!;
    const int = Swift.metadataFor("Swift.Int")!;
    const manual = instantiateGenericMetadata(findType("Swift.Dictionary")!, [
      string.handle,
      int.handle,
      conformsToProtocol(string, findProtocol("Swift.Hashable")!)!,
    ]);
    const auto = buildGenericMetadata(findType("Swift.Dictionary")!, [string, int]);
    expect(auto.handle.equals(manual.handle)).toBeTruthy();
  });

  test("unconstrained generics still work through the same path", () => {
    requireSwift();
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!]);
    expect(arrayInt!.kind).toBe(MetadataKind.Struct);
  });
});
