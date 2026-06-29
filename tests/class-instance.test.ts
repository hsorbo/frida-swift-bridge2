import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { findType } from "../src/reflection/registry.js";
import { getClassMetadata, enumerateClassFields } from "../src/abi/class-metadata.js";
import { enumerateClassInstanceFields, readObject } from "../src/abi/instance.js";

// Allocate a real heap instance of `metadata`'s class (isa set by the runtime).
function allocObject(metadataHandle: NativePointer, size: number, alignMask: number): NativePointer {
  const fn = new NativeFunction(
    Process.getModuleByName("libswiftCore.dylib").getExportByName("swift_allocObject"),
    "pointer",
    ["pointer", "size_t", "size_t"]
  );
  return fn(metadataHandle, size, alignMask) as NativePointer;
}

describe("class instances", () => {
  test("reads an object's stored property through its isa", () => {
    requireSwift();
    const descriptor = findType("Swift.__RawSetStorage");
    if (descriptor === null) {
      throw new Error("Swift.__RawSetStorage not present");
    }
    const metadata = getClassMetadata(descriptor!);

    const object = allocObject(metadata.handle, metadata.instanceSize, metadata.instanceAlignment - 1);
    // Zero the field region (the 16-byte object header stays as the runtime set it).
    for (let offset = 16; offset < metadata.instanceSize; offset++) {
      object.add(offset).writeU8(0);
    }
    object.add(16).writeS64(42); // _count

    const fields = [...enumerateClassInstanceFields(object)];
    expect(fields[0].name).toBe("_count");
    expect(fields[0].address.equals(object.add(16))).toBeTruthy();

    expect(readObject(object)._count).toBe(42);
  });

  test("includes fields inherited from a Swift superclass", () => {
    requireSwift();
    const descriptor = findType("Swift.__EmptySetSingleton");
    if (descriptor === null) {
      throw new Error("Swift.__EmptySetSingleton not present");
    }
    const metadata = getClassMetadata(descriptor!);

    // _count is declared by the superclass __RawSetStorage, not this class.
    const ownNames = [...enumerateClassFields(metadata)].map((f) => f.field.name);
    expect(ownNames).not.toContain("_count");

    const object = allocObject(metadata.handle, metadata.instanceSize, metadata.instanceAlignment - 1);
    for (let offset = 16; offset < metadata.instanceSize; offset++) {
      object.add(offset).writeU8(0);
    }
    object.add(16).writeS64(7); // inherited _count

    const allNames = [...enumerateClassInstanceFields(object)].map((f) => f.name);
    expect(allNames).toContain("_count");
    expect(readObject(object)._count).toBe(7);
  });
});
