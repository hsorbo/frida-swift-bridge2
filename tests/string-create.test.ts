import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, StructType } from "../src/index.js";
import { createString, writeString } from "../src/abi/string.js";
import { readString } from "../src/abi/string.js";

// createString hands back a +1 String; read its text and settle the +1 (or it leaks __StringStorage).
function takeText(buf: NativePointer): string | null {
  const text = readString(buf);
  Swift.metadataFor("Swift.String")!.valueWitnesses.destroy(buf);
  return text;
}

describe("createString / writeString", () => {
  test("round-trips a small (inline) string", ({ skip }) => {
    loadFixture(skip);
    expect(takeText(createString("short"))).toBe("short");
  });

  test("round-trips a large (heap) string", ({ skip }) => {
    loadFixture(skip);
    const text = "this string is definitely longer than fifteen bytes";
    expect(takeText(createString(text))).toBe(text);
  });

  test("round-trips empty and unicode strings", ({ skip }) => {
    loadFixture(skip);
    expect(takeText(createString(""))).toBe("");
    expect(takeText(createString("café ☕ 日本語"))).toBe("café ☕ 日本語");
  });

  test("writeString moves a value into an existing buffer", ({ skip }) => {
    loadFixture(skip);
    const buf = Memory.alloc(Process.pointerSize * 2);
    writeString(buf, "moved into place");
    expect(takeText(buf)).toBe("moved into place");
  });
});

describe("writeValue String support", () => {
  test("ValueInstance.fromJS builds a String value", ({ skip }) => {
    loadFixture(skip);
    const v = Swift.typeOf(Swift.metadataFor("Swift.String")!);
    const value = (v as StructType).new("hello from JS");
    expect(value.get()).toBe("hello from JS");
    value.dispose();
  });

  test("constructs a struct with a String field", ({ skip }) => {
    loadFixture(skip);
    const t = Swift.typeOf(Swift.metadataFor("fixture.PoliteGreeter")!) as StructType;
    const value = t.new({ name: "Ada" });
    expect(value.get()).toEqual({ name: "Ada" });
    value.dispose();
  });
});
