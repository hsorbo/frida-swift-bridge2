import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { readValue } from "../src/abi/instance.js";

function box(write: (p: NativePointer) => void, size = 8): NativePointer {
  const storage = Memory.alloc(size);
  write(storage);
  return storage;
}

describe("readValue", () => {
  test("decodes integer primitives", ({ skip }) => {
    requireSwift(skip);
    expect(readValue(Swift.metadataFor("Swift.Int")!, box((p) => p.writeS64(-42)))).toBe(-42);
    expect(readValue(Swift.metadataFor("Swift.UInt8")!, box((p) => p.writeU8(200)))).toBe(200);
    expect(readValue(Swift.metadataFor("Swift.Int32")!, box((p) => p.writeS32(-7)))).toBe(-7);
  });

  test("decodes bool and floating point", ({ skip }) => {
    requireSwift(skip);
    expect(readValue(Swift.metadataFor("Swift.Bool")!, box((p) => p.writeU8(1)))).toBe(true);
    expect(readValue(Swift.metadataFor("Swift.Bool")!, box((p) => p.writeU8(0)))).toBe(false);
    expect(readValue(Swift.metadataFor("Swift.Double")!, box((p) => p.writeDouble(3.5)))).toBe(3.5);
  });

  test("recurses into nested struct fields", ({ skip }) => {
    requireSwift(skip);
    const rangeInt = Swift.metadataFor("Swift.Range", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(rangeInt.typeLayout.stride);
    storage.writeU64(10);
    storage.add(8).writeU64(20);
    expect(readValue(rangeInt, storage)).toEqual({ lowerBound: 10, upperBound: 20 });
  });

  test("returns a class-typed field as its reference pointer", ({ skip }) => {
    requireSwift(skip);
    const klass = Swift.metadataFor("Swift.__RawSetStorage")!;
    const slot = Memory.alloc(Process.pointerSize);
    slot.writePointer(ptr("0x1234"));
    expect((readValue(klass, slot) as NativePointer).equals(ptr("0x1234"))).toBeTruthy();
  });
});
