import { test, expect, describe } from "@frida/injest/agent";
import { loadSwiftCore } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind, instantiateGenericMetadata } from "../src/abi/metadata.js";
import { ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import {
  enumerateProtocolConformances,
  findProtocol,
  conformsToProtocol,
} from "../src/abi/protocol-conformance.js";

describe("protocol conformances", () => {
  test("enumerates conformances whose protocol resolves", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    let count = 0;
    let named = 0;
    for (const conformance of enumerateProtocolConformances(lib)) {
      count++;
      const protocol = conformance.protocol;
      if (protocol !== null && protocol.kind === ContextDescriptorKind.Protocol) {
        named++;
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(0);
  });

  test("finds a stdlib protocol descriptor by name", ({ skip }) => {
    loadSwiftCore(skip);
    const hashable = findProtocol("Swift.Hashable");
    expect(hashable).not.toBeNull();
    expect(hashable!.kind).toBe(ContextDescriptorKind.Protocol);
  });

  test("returns a witness table when a type conforms", ({ skip }) => {
    loadSwiftCore(skip);
    const witnessTable = conformsToProtocol(
      Swift.metadataFor("Swift.Int")!,
      findProtocol("Swift.Hashable")!
    );
    expect(witnessTable).not.toBeNull();
  });

  test("returns null when a type does not conform", ({ skip }) => {
    loadSwiftCore(skip);
    const sequence = findProtocol("Swift.Sequence");
    expect(sequence).not.toBeNull();
    expect(conformsToProtocol(Swift.metadataFor("Swift.Int")!, sequence!)).toBeNull();
  });

  test("instantiates a constrained generic with a witness-table key argument", ({ skip }) => {
    loadSwiftCore(skip);
    const string = Swift.metadataFor("Swift.String")!;
    const int = Swift.metadataFor("Swift.Int")!;
    const keyHashableWitness = conformsToProtocol(string, findProtocol("Swift.Hashable")!)!;

    const dictionary = instantiateGenericMetadata(findType("Swift.Dictionary")!, [
      string.handle,
      int.handle,
      keyHashableWitness,
    ]);
    expect(dictionary.kind).toBe(MetadataKind.Struct);
    expect(dictionary.description.handle.equals(findType("Swift.Dictionary")!.handle)).toBeTruthy();
  });
});
