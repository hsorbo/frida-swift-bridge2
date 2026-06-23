import { test, expect, describe } from "@frida/injest/agent";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind, instantiateGenericMetadata } from "../src/abi/metadata.js";
import { buildGenericMetadata } from "../src/abi/generic-instantiation.js";
import { findProtocol, conformsToProtocol } from "../src/abi/protocol-conformance.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

describe("constrained generic auto-assembly", () => {
  test("Dictionary<String,Int> instantiates without supplying a witness table", ({ skip }) => {
    requireSwift(skip);
    const dictionary = Swift.metadataFor("Swift.Dictionary", [
      Swift.metadataFor("Swift.String")!,
      Swift.metadataFor("Swift.Int")!,
    ]);
    expect(dictionary).not.toBeNull();
    expect(dictionary!.kind).toBe(MetadataKind.Struct);
    expect(dictionary!.description.handle.equals(findType("Swift.Dictionary")!.handle)).toBeTruthy();
  });

  test("Set<Int> resolves its Hashable requirement", ({ skip }) => {
    requireSwift(skip);
    const set = Swift.metadataFor("Swift.Set", [Swift.metadataFor("Swift.Int")!]);
    expect(set).not.toBeNull();
    expect(set!.kind).toBe(MetadataKind.Struct);
  });

  test("auto-assembly matches a hand-built key-argument vector", ({ skip }) => {
    requireSwift(skip);
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

  test("unconstrained generics still work through the same path", ({ skip }) => {
    requireSwift(skip);
    const arrayInt = Swift.metadataFor("Swift.Array", [Swift.metadataFor("Swift.Int")!]);
    expect(arrayInt!.kind).toBe(MetadataKind.Struct);
  });
});
