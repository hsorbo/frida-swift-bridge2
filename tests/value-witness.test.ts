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
  test("exposes layout + flags for Int (POD, inline)", ({ skip }) => {
    requireSwift(skip);
    const vwt = Swift.metadataFor("Swift.Int")!.valueWitnesses;
    expect(vwt.size).toBe(8);
    expect(vwt.stride).toBe(8);
    expect(vwt.alignment).toBe(8);
    expect(vwt.isPOD).toBe(true);
    expect(vwt.isInlineStorage).toBe(true);
    expect(vwt.isBitwiseTakable).toBe(true);
  });

  test("String is non-POD but bitwise-takable and inline", ({ skip }) => {
    requireSwift(skip);
    const vwt = Swift.metadataFor("Swift.String")!.valueWitnesses;
    expect(vwt.size).toBe(16);
    expect(vwt.stride).toBe(16);
    expect(vwt.isPOD).toBe(false);
    expect(vwt.isBitwiseTakable).toBe(true);
    expect(vwt.isInlineStorage).toBe(true); // 16 <= 3 words
  });

  test("initializeWithCopy duplicates a POD value", ({ skip }) => {
    requireSwift(skip);
    const vwt = Swift.metadataFor("Swift.Int")!.valueWitnesses;
    const src = Memory.alloc(8);
    src.writeU64(0x12345678);
    const dest = Memory.alloc(8);
    const ret = vwt.initializeWithCopy(dest, src);
    expect(ret.equals(dest)).toBe(true);
    expect(dest.readU64().toNumber()).toBe(0x12345678);
    vwt.destroy(dest);
  });

  test("buffer round-trip projects an inline String value", ({ skip }) => {
    requireSwift(skip);
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

  test("reports out-of-line storage for structs larger than 3 words", ({ skip }) => {
    loadFixture(skip);
    const loadable = Swift.metadataFor("fixture.LoadableStruct")!.valueWitnesses;
    const big = Swift.metadataFor("fixture.BigStruct")!.valueWitnesses;
    expect(loadable.size).toBe(32);
    expect(big.size).toBe(40);
    expect(loadable.isInlineStorage).toBe(false);
    expect(big.isInlineStorage).toBe(false);
    expect(big.isPOD).toBe(true);
    expect(big.isBitwiseTakable).toBe(true);
  });

  test("initializeWithCopy duplicates an out-of-line value", ({ skip }) => {
    loadFixture(skip);
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
