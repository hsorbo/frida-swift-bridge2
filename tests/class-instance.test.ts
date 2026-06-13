import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { findType } from "../src/reflection/registry.js";
import { getClassMetadata } from "../src/abi/class-metadata.js";
import { enumerateClassInstanceFields, readObject } from "../src/abi/instance.js";

function requireSwift(skip: (reason?: string) => void) {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
  const descriptor = findType("Swift.__RawSetStorage");
  if (descriptor === null) {
    skip("Swift.__RawSetStorage not present");
  }
  return descriptor!;
}

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
  test("reads an object's stored property through its isa", ({ skip }) => {
    const descriptor = requireSwift(skip);
    const metadata = getClassMetadata(descriptor);

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
});
