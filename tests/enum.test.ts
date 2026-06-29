import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { readValue } from "../src/abi/instance.js";
import { readEnumCase, enumTag, injectEnumTag, projectBox } from "../src/abi/enum.js";

describe("enum instances", () => {
  test("tag injection round-trips and maps to the payload-first case order", () => {
    requireSwift();
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
    expect(noneCase.isIndirect).toBeFalsy();
  });

  test("reads a boxed payload via projectBox (the indirect-case mechanism)", () => {
    requireSwift();
    const lib = Process.getModuleByName("libswiftCore.dylib");
    const allocBox = new NativeFunction(
      lib.getExportByName("swift_allocBox"),
      ["pointer", "pointer"],
      ["pointer"]
    );
    const int = Swift.metadataFor("Swift.Int")!;
    const pair = allocBox(int.handle) as unknown as [NativePointer, NativePointer];
    const object = pair[0];
    const buffer = pair[1];
    buffer.writeS64(99);

    // projectBox recomputes the value address from the box object, matching the
    // pointer an indirect enum case stores after projectEnumData.
    expect(projectBox(object).equals(buffer)).toBeTruthy();
    expect(readValue(int, projectBox(object))).toBe(99);
  });

  test("decodes a payload case and reads its associated value", () => {
    requireSwift();
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    storage.writeS64(42);
    injectEnumTag(optionalInt, storage, 0);
    expect(readValue(optionalInt, storage)).toEqual({ some: 42 });
  });

  test("decodes a no-payload case to its name", () => {
    requireSwift();
    const optionalInt = Swift.metadataFor("Swift.Optional", [Swift.metadataFor("Swift.Int")!])!;
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    injectEnumTag(optionalInt, storage, 1);
    expect(readValue(optionalInt, storage)).toBe("none");
  });

  test("reads an enum field nested in a struct value", () => {
    requireSwift();
    const int = Swift.metadataFor("Swift.Int")!;
    const optionalInt = Swift.metadataFor("Swift.Optional", [int])!;
    // hand-build a payload Optional<Int> and confirm it round-trips through readValue
    const storage = Memory.alloc(optionalInt.typeLayout.stride);
    storage.writeS64(7);
    injectEnumTag(optionalInt, storage, 0);
    expect(readValue(optionalInt, storage)).toEqual({ some: 7 });
  });
});
