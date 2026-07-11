import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift } from "../src/index.js";
import { allocateValueBuffer } from "../src/abi/value-witness.js";
import { readString } from "../src/abi/string.js";

function writeSmallString(p: NativePointer, s: string): void {
  p.writeU64(0);
  p.add(8).writeU64(0);
  for (let i = 0; i < s.length; i++) {
    p.add(i).writeU8(s.charCodeAt(i));
  }
  p.add(15).writeU8(0xe0 | s.length); // immortal | ascii | small | count
}

describe("ValueWitnessTable", () => {
  test("exposes layout + flags for Int (POD, inline)", () => {
    requireSwift();
    const vwt = Swift.metadataFor("Swift.Int")!.valueWitnesses;
    expect(vwt.size).toBe(8);
    expect(vwt.stride).toBe(8);
    expect(vwt.alignment).toBe(8);
    expect(vwt.isPOD).toBe(true);
    expect(vwt.isInlineStorage).toBe(true);
    expect(vwt.isBitwiseTakable).toBe(true);
    expect(vwt.isCopyable).toBe(true);
  });

  test("String is non-POD but bitwise-takable and inline", () => {
    requireSwift();
    const vwt = Swift.metadataFor("Swift.String")!.valueWitnesses;
    expect(vwt.size).toBe(16);
    expect(vwt.stride).toBe(16);
    expect(vwt.isPOD).toBe(false);
    expect(vwt.isBitwiseTakable).toBe(true);
    expect(vwt.isInlineStorage).toBe(true); // 16 <= 3 words
  });

  test("initializeWithCopy duplicates a POD value", () => {
    requireSwift();
    const vwt = Swift.metadataFor("Swift.Int")!.valueWitnesses;
    const src = Memory.alloc(8);
    src.writeU64(0x12345678);
    const dest = Memory.alloc(8);
    const ret = vwt.initializeWithCopy(dest, src);
    expect(ret.equals(dest)).toBe(true);
    expect(dest.readU64().toNumber()).toBe(0x12345678);
    vwt.destroy(dest);
  });

  test("buffer round-trip projects an inline String value", () => {
    requireSwift();
    const vwt = Swift.metadataFor("Swift.String")!.valueWitnesses;
    const srcBuf = allocateValueBuffer();
    writeSmallString(srcBuf, "vwt!");
    const destBuf = allocateValueBuffer();
    const value = vwt.initializeBufferWithCopyOfBuffer(destBuf, srcBuf);
    expect(value.equals(destBuf)).toBe(true); // inline -> buffer itself
    expect(vwt.projectBuffer(destBuf).equals(destBuf)).toBe(true);
    expect(readString(value)).toBe("vwt!");
    vwt.destroy(value);
  });

  test("reports out-of-line storage for structs larger than 3 words", () => {
    loadFixture();
    const loadable = Swift.metadataFor("fixture.LoadableStruct")!.valueWitnesses;
    const big = Swift.metadataFor("fixture.BigStruct")!.valueWitnesses;
    expect(loadable.size).toBe(32);
    expect(big.size).toBe(40);
    expect(loadable.isInlineStorage).toBe(false);
    expect(big.isInlineStorage).toBe(false);
    expect(big.isPOD).toBe(true);
    expect(big.isBitwiseTakable).toBe(true);
  });

  test("noncopyable struct reports isCopyable false and refuses copies", () => {
    loadFixture();
    const vwt = Swift.metadataFor("fixture.NoncopyableStruct")!.valueWitnesses;
    expect(vwt.isCopyable).toBe(false);
    const src = Memory.alloc(vwt.stride);
    src.writeU64(7);
    const dest = Memory.alloc(vwt.stride);
    expect(() => vwt.initializeWithCopy(dest, src)).toThrow(/noncopyable/);
    expect(() => vwt.assignWithCopy(dest, src)).toThrow(/noncopyable/);
    expect(() => vwt.initializeBufferWithCopyOfBuffer(dest, src)).toThrow(/noncopyable/);
  });

  test("reports extra-inhabitant counts from the type layout", () => {
    requireSwift();
    expect(Swift.metadataFor("Swift.Int")!.valueWitnesses.extraInhabitantCount).toBe(0);
    expect(Swift.metadataFor("Swift.Bool")!.valueWitnesses.extraInhabitantCount).toBe(254);
    // a class pointer's invalid low addresses are all extra inhabitants
    expect(
      Swift.metadataFor("Swift.__RawSetStorage")!.valueWitnesses.extraInhabitantCount
    ).toBeGreaterThan(0);
  });

  test("single-payload witnesses discriminate a class optional's nil", () => {
    requireSwift();
    const cls = Swift.metadataFor("Swift.__RawSetStorage")!;
    const vwt = cls.valueWitnesses;
    const storage = Memory.alloc(Process.pointerSize);

    storage.writePointer(cls.handle); // any valid high pointer is the payload case
    expect(vwt.getEnumTagSinglePayload(storage, 1)).toBe(0);

    storage.writePointer(ptr(0));
    expect(vwt.getEnumTagSinglePayload(storage, 1)).toBe(1); // nil -> empty case

    storage.writePointer(cls.handle);
    vwt.storeEnumTagSinglePayload(storage, 1, 1); // overwrite with the empty case
    expect(vwt.getEnumTagSinglePayload(storage, 1)).toBe(1);
  });

  test("initializeWithCopy duplicates an out-of-line value", () => {
    loadFixture();
    const vwt = Swift.metadataFor("fixture.BigStruct")!.valueWitnesses;
    const src = Memory.alloc(vwt.stride);
    for (let i = 0; i < 5; i++) {
      src.add(i * 8).writeU64(i + 1);
    }
    const dest = Memory.alloc(vwt.stride);
    vwt.initializeWithCopy(dest, src);
    for (let i = 0; i < 5; i++) {
      expect(dest.add(i * 8).readU64().toNumber()).toBe(i + 1);
    }
    vwt.destroy(dest);
  });
});
