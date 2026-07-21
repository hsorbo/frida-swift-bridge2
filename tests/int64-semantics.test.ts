import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, readValue, writeValue } from "../src/index.js";

describe("64-bit integer semantics", () => {
  beforeEach(() => {
    loadFixture();
  });

  function roundtrip(typeName: string, value: number | Int64 | UInt64) {
    const metadata = Swift.metadataFor(typeName)!;
    const buffer = Memory.alloc(metadata.typeLayout.stride);
    writeValue(metadata, buffer, value);
    return readValue(metadata, buffer);
  }

  test("Swift.Int decodes as an Int64, exact above 2^53", () => {
    const big = int64("9007199254740993"); // 2^53 + 1, unrepresentable as a JS number
    const out = roundtrip("Swift.Int", big);
    expect(out instanceof Int64).toBe(true);
    expect((out as Int64).toString()).toBe("9007199254740993");
  });

  test("Swift.UInt64 decodes as a UInt64, exact near 2^64", () => {
    const big = uint64("18446744073709551615"); // 2^64 - 1
    const out = roundtrip("Swift.UInt64", big);
    expect(out instanceof UInt64).toBe(true);
    expect((out as UInt64).toString()).toBe("18446744073709551615");
  });

  test("writeValue accepts a plain number for a 64-bit field", () => {
    const out = roundtrip("Swift.Int64", -42);
    expect((out as Int64).toNumber()).toBe(-42);
  });

  test("32-bit integers stay plain numbers", () => {
    expect(typeof roundtrip("Swift.Int32", -7)).toBe("number");
  });
});
