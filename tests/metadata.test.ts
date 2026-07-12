import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { getMetadata, getGenericMetadata, Metadata, MetadataKind } from "../src/abi/metadata.js";
import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { typeOf } from "../src/runtime/swift-type.js";

const FLAG_IS_GENERIC = 0x80;

describe("metadata", () => {
  test("resolves Int layout via the access function", () => {
    requireSwift();
    const int = getMetadata(findType("Swift.Int")!);
    expect(int.kind).toBe(MetadataKind.Struct);
    const layout = int.typeLayout;
    expect(layout.size).toBe(8);
    expect(layout.stride).toBe(8);
    expect(layout.alignment).toBe(8);
  });

  test("reads single-byte layout for Bool", () => {
    requireSwift();
    const layout = getMetadata(findType("Swift.Bool")!).typeLayout;
    expect(layout.size).toBe(1);
    expect(layout.stride).toBe(1);
    expect(layout.alignment).toBe(1);
  });

  test("metadata pointer is stable / cached", () => {
    requireSwift();
    const descriptor = findType("Swift.Double")!;
    expect(getMetadata(descriptor).handle.equals(getMetadata(descriptor).handle)).toBeTruthy();
  });

  test("throws for a generic type without arguments", () => {
    requireSwift();
    const array = findType("Swift.Array")!;
    expect(array.isGeneric).toBeTruthy();
    expect(() => getMetadata(array)).toThrow();
  });

  test("Swift.metadataFor returns null for an unknown type", () => {
    requireSwift();
    expect(Swift.metadataFor("Swift.NoSuchTypeQX")).toBeNull();
    expect(Swift.metadataFor("Swift.Int")!.typeLayout.size).toBe(8);
  });

  test("getGenericMetadata throws for an opaque type descriptor rather than reading a bogus access function", () => {
    const descriptor = Memory.alloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC);

    const ctx = new ContextDescriptor(descriptor);
    expect(() => getGenericMetadata(ctx, [])).toThrow();
  });

  test("typeOf rejects the FixedArray and Borrow kinds that slip under the class normalization", () => {
    for (const kind of [MetadataKind.FixedArray, MetadataKind.Borrow]) {
      const handle = Memory.alloc(Process.pointerSize);
      handle.writeU32(kind);
      expect(new Metadata(handle).kind).toBe(kind);
      expect(() => typeOf(new Metadata(handle))).toThrow(new RegExp(MetadataKind[kind]));
    }
  });
});
