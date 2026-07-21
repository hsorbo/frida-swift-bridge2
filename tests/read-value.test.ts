import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { resolveTypeByMangledName, metadataFor } from "../src/abi.js";
import { readValue } from "../src/abi/instance.js";

import { Swift } from "../src/index.js";
function box(write: (p: NativePointer) => void, size = 8): NativePointer {
  const storage = Memory.alloc(size);
  write(storage);
  return storage;
}

function mangledType(mangled: string) {
  return resolveTypeByMangledName({
    address: Memory.allocUtf8String(mangled),
    length: mangled.length,
  })!;
}

describe("readValue", () => {
  test("decodes integer primitives", () => {
    requireSwift();
    expect(readValue(metadataFor("Swift.Int")!, box((p) => p.writeS64(-42)))).toEqual(int64(-42));
    expect(readValue(metadataFor("Swift.UInt8")!, box((p) => p.writeU8(200)))).toBe(200);
    expect(readValue(metadataFor("Swift.Int32")!, box((p) => p.writeS32(-7)))).toBe(-7);
  });

  test("decodes bool and floating point", () => {
    requireSwift();
    expect(readValue(metadataFor("Swift.Bool")!, box((p) => p.writeU8(1)))).toBe(true);
    expect(readValue(metadataFor("Swift.Bool")!, box((p) => p.writeU8(0)))).toBe(false);
    expect(readValue(metadataFor("Swift.Double")!, box((p) => p.writeDouble(3.5)))).toBe(3.5);
  });

  test("recurses into nested struct fields", () => {
    requireSwift();
    const rangeInt = metadataFor("Swift.Range", [metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(rangeInt.typeLayout.stride);
    storage.writeU64(10);
    storage.add(8).writeU64(20);
    expect(readValue(rangeInt, storage)).toEqual({ lowerBound: int64(10), upperBound: int64(20) });
  });

  test("decodes a tuple as a positional array", () => {
    requireSwift();
    const tuple = mangledType("Si_Sit"); // (Int, Int)
    const storage = Memory.alloc(tuple.typeLayout.stride);
    storage.writeU64(7);
    storage.add(8).writeU64(11);
    expect(readValue(tuple, storage)).toEqual([int64(7), int64(11)]);
  });

  test("returns a class-typed field as its reference pointer", () => {
    requireSwift();
    const klass = metadataFor("Swift.__RawSetStorage")!;
    const slot = Memory.alloc(Process.pointerSize);
    slot.writePointer(ptr("0x1234"));
    expect((readValue(klass, slot) as NativePointer).equals(ptr("0x1234"))).toBeTruthy();
  });
});
