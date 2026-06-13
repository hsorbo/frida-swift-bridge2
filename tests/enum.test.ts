import { test, expect, describe } from "frida-test/agent";

import { Swift } from "../src/index.js";
import { readValue } from "../src/abi/instance.js";
import { readEnumCase, enumTag, injectEnumTag } from "../src/abi/enum.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

describe("enum instances", () => {
  test("tag injection round-trips and maps to the payload-first case order", ({ skip }) => {
    requireSwift(skip);
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(optionalInt.typeLayout.stride);

    injectEnumTag(optionalInt, storage, 0);
    expect(enumTag(optionalInt, storage)).toBe(0);
    expect(readEnumCase(optionalInt, storage).name).toBe("some");

    injectEnumTag(optionalInt, storage, 1);
    expect(enumTag(optionalInt, storage)).toBe(1);
    const noneCase = readEnumCase(optionalInt, storage);
    expect(noneCase.name).toBe("none");
    expect(noneCase.payloadType).toBeNull();
  });

  test("decodes a payload case and reads its associated value", ({ skip }) => {
    requireSwift(skip);
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    storage.writeS64(42);
    injectEnumTag(optionalInt, storage, 0);
    expect(readValue(optionalInt, storage)).toEqual({ some: 42 });
  });

  test("decodes a no-payload case to its name", ({ skip }) => {
    requireSwift(skip);
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    injectEnumTag(optionalInt, storage, 1);
    expect(readValue(optionalInt, storage)).toBe("none");
  });

  test("reads an enum field nested in a struct value", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const optionalInt = Swift.metadataFor("Swift.Optional", [int])!;
    // hand-build a payload Optional<Int> and confirm it round-trips through readValue
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    storage.writeS64(7);
    injectEnumTag(optionalInt, storage, 0);
    expect(readValue(optionalInt, storage)).toEqual({ some: 7 });
  });
});
