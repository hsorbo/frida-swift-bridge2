import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { readString } from "../src/abi/string.js";
import { readValue } from "../src/abi/instance.js";

// Build a small-string _StringObject (ASCII, <= 15 bytes) in 16 bytes.
function writeSmallString(p: NativePointer, s: string): void {
  p.writeU64(0);
  p.add(8).writeU64(0);
  for (let i = 0; i < s.length; i++) {
    p.add(i).writeU8(s.charCodeAt(i));
  }
  p.add(15).writeU8(0xe0 | s.length); // immortal | ascii | small | count
}

describe("readString", () => {
  test("decodes small (inline) strings", () => {
    requireSwift();
    const buf = Memory.alloc(16);

    writeSmallString(buf, "");
    expect(readString(buf)).toBe("");

    writeSmallString(buf, "hi");
    expect(readString(buf)).toBe("hi");

    writeSmallString(buf, "fifteen chars!!"); // exactly 15
    expect(readString(buf)).toBe("fifteen chars!!");
  });

  test("decodes a real native (large) string via _typeName", () => {
    requireSwift();
    const lib = Process.getModuleByName("libswiftCore.dylib");
    let typeNameFn: NativePointer;
    try {
      typeNameFn = lib.getExportByName("$ss9_typeName_9qualifiedSSypXp_SbtF");
    } catch (e) {
      throw new Error("_typeName not exported under the expected mangling");
    }
    const fn = new NativeFunction(typeNameFn, ["uint64", "uint64"], ["pointer", "bool"]);
    const dict = Swift.metadataFor("Swift.Dictionary", [
      Swift.metadataFor("Swift.String")!,
      Swift.metadataFor("Swift.Int")!,
    ])!;
    const ret = fn(dict.handle, 1) as unknown as [UInt64, UInt64];

    const storage = Memory.alloc(16);
    storage.writeU64(ret[0]);
    storage.add(8).writeU64(ret[1]);
    const name = readString(storage)!;
    expect(name.length).toBeGreaterThan(15); // proves it took the large path
    expect(name).toContain("Dictionary");
    expect(name).toContain("Swift.String");
  });

  test("readValue decodes String fields of a struct", () => {
    requireSwift();
    const rangeString = Swift.metadataFor("Swift.Range", [Swift.metadataFor("Swift.String")!])!;
    const buf = Memory.alloc(rangeString.typeLayout.stride);
    writeSmallString(buf, "a");
    writeSmallString(buf.add(16), "z");
    expect(readValue(rangeString, buf)).toEqual({ lowerBound: "a", upperBound: "z" });
  });
});
