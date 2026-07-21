import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { MetadataKind } from "../src/abi/metadata.js";
import {
  enumerateFields,
  resolveFieldType,
  resolveTypeByMangledName,
  symbolicMangledNameLength,
} from "../src/abi/field-descriptor.js";

import { metadataFor } from "../src/abi.js";
describe("symbolic mangled name length", () => {
  test("counts past embedded symbolic-reference payloads with NUL bytes", () => {
    // 'B' then a 0x02 relative reference whose 4-byte payload contains 0x00,
    // then 'y', then NUL. A naive strlen would stop inside the payload.
    const buffer = Memory.alloc(16);
    buffer.writeByteArray([
      0x42, // 'B'
      0x02, // relative symbolic reference (skip 4)
      0x00, 0x10, 0x00, 0x00, // payload with NULs
      0x79, // 'y'
      0x00, // terminator
    ]);
    expect(symbolicMangledNameLength(buffer)).toBe(7);
  });

  test("counts an absolute reference as eight payload bytes", () => {
    const buffer = Memory.alloc(16);
    buffer.writeByteArray([
      0x18, // absolute symbolic reference (skip 8)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00,
    ]);
    expect(symbolicMangledNameLength(buffer)).toBe(9);
  });
});

describe("field descriptor", () => {
  test("enumerates the stored property of a stdlib struct", () => {
    requireSwift();
    const fields = [...enumerateFields(findType("Swift.Bool")!)];
    expect(fields.length).toBe(1);
    expect(fields[0].name).toBe("_value");
  });

  test("resolves a plain mangled name through the runtime", () => {
    requireSwift();
    const name = Memory.allocUtf8String("Si");
    const int = resolveTypeByMangledName({ address: name, length: 2 });
    expect(int).not.toBeNull();
    expect(int!.kind).toBe(MetadataKind.Struct);
    expect(int!.handle.equals(metadataFor("Swift.Int")!.handle)).toBeTruthy();
  });

  test("resolves a field type carrying a symbolic reference", () => {
    requireSwift();
    const string = findType("Swift.String")!;
    const fields = [...enumerateFields(string)];
    expect(fields.length).toBeGreaterThan(0);
    const resolved = resolveFieldType(fields[0], string);
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe(MetadataKind.Struct);
  });
});
