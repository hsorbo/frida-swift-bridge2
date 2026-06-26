import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, readValue, writeValue, projectBox } from "../src/index.js";
import { getSwiftCoreApi } from "../src/runtime/api.js";

function roundTrip(metadata: ReturnType<typeof Swift.metadataFor>) {
  const storage = Memory.alloc(metadata!.typeLayout.stride);
  return {
    storage,
    write: (v: Parameters<typeof writeValue>[2]) => {
      writeValue(metadata!, storage, v);
      return readValue(metadata!, storage);
    },
  };
}

describe("writeValue", () => {
  test("materializes integer primitives", ({ skip }) => {
    requireSwift(skip);
    expect(roundTrip(Swift.metadataFor("Swift.Int")).write(-42)).toBe(-42);
    expect(roundTrip(Swift.metadataFor("Swift.UInt8")).write(200)).toBe(200);
    expect(roundTrip(Swift.metadataFor("Swift.Bool")).write(true)).toBe(true);
    expect(roundTrip(Swift.metadataFor("Swift.Double")).write(3.5)).toBe(3.5);
  });

  test("recurses into nested struct fields", ({ skip }) => {
    loadFixture(skip);
    const Loadable = Swift.metadataFor("fixture.LoadableStruct");
    expect(roundTrip(Loadable).write({ a: 1, b: 2, c: 3, d: 4 })).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
  });

  test("injects a payload enum case", ({ skip }) => {
    loadFixture(skip);
    expect(roundTrip(Swift.metadataFor("fixture.Pick")).write({ value: 7 })).toEqual({ value: 7 });
  });

  test("injects an empty enum case", ({ skip }) => {
    loadFixture(skip);
    expect(roundTrip(Swift.metadataFor("fixture.Pick")).write("empty")).toBe("empty");
  });

  test("rejects a non-constructible primitive", ({ skip }) => {
    requireSwift(skip);
    const String_ = Swift.metadataFor("Swift.String")!;
    expect(() => writeValue(String_, Memory.alloc(String_.typeLayout.stride), "hi")).toThrow();
  });

  test("writes into a freshly allocated box", ({ skip }) => {
    requireSwift(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    const { swift_allocBox, swift_release } = getSwiftCoreApi();
    const [object, buffer] = swift_allocBox(Int.handle);
    writeValue(Int, buffer, 99);
    expect(readValue(Int, buffer)).toBe(99);
    expect(projectBox(object).equals(buffer)).toBe(true);
    swift_release(object);
  });
});
