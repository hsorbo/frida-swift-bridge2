import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { getMetadata, MetadataKind } from "../src/abi/metadata.js";

describe("metadata", () => {
  test("resolves Int layout via the access function", ({ skip }) => {
    requireSwift(skip);
    const int = getMetadata(findType("Swift.Int")!);
    expect(int.kind).toBe(MetadataKind.Struct);
    const layout = int.typeLayout;
    expect(layout.size).toBe(8);
    expect(layout.stride).toBe(8);
    expect(layout.alignment).toBe(8);
  });

  test("reads single-byte layout for Bool", ({ skip }) => {
    requireSwift(skip);
    const layout = getMetadata(findType("Swift.Bool")!).typeLayout;
    expect(layout.size).toBe(1);
    expect(layout.stride).toBe(1);
    expect(layout.alignment).toBe(1);
  });

  test("metadata pointer is stable / cached", ({ skip }) => {
    requireSwift(skip);
    const descriptor = findType("Swift.Double")!;
    expect(getMetadata(descriptor).handle.equals(getMetadata(descriptor).handle)).toBeTruthy();
  });

  test("throws for a generic type without arguments", ({ skip }) => {
    requireSwift(skip);
    const array = findType("Swift.Array")!;
    expect(array.isGeneric).toBeTruthy();
    expect(() => getMetadata(array)).toThrow();
  });

  test("Swift.metadataFor returns null for an unknown type", ({ skip }) => {
    requireSwift(skip);
    expect(Swift.metadataFor("Swift.NoSuchTypeQX")).toBeNull();
    expect(Swift.metadataFor("Swift.Int")!.typeLayout.size).toBe(8);
  });
});
