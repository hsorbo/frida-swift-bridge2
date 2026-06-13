import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { enumerateInstanceFields } from "../src/abi/instance.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

describe("instance fields", () => {
  test("reads struct stored properties at their field offsets", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const rangeInt = Swift.metadataFor("Swift.Range", [int])!;
    expect(rangeInt.kind).toBe(MetadataKind.Struct);

    const storage = Memory.alloc(rangeInt.typeLayout.stride);
    storage.writeU64(10);
    storage.add(8).writeU64(20);

    const fields = [...enumerateInstanceFields(rangeInt, storage)];
    expect(fields.length).toBe(2);

    expect(fields[0].name).toBe("lowerBound");
    expect(fields[0].address.equals(storage)).toBeTruthy();
    expect(fields[0].address.readU64().toNumber()).toBe(10);
    expect(fields[0].type!.handle.equals(int.handle)).toBeTruthy();

    expect(fields[1].name).toBe("upperBound");
    expect(fields[1].address.equals(storage.add(8))).toBeTruthy();
    expect(fields[1].address.readU64().toNumber()).toBe(20);
  });

  test("rejects non-struct metadata", ({ skip }) => {
    requireSwift(skip);
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    expect(() => [...enumerateInstanceFields(optionalInt, Memory.alloc(16))]).toThrow();
  });
});
