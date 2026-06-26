import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Metadata,
  readValue,
  readObject,
  existentialRepresentation,
} from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureFn(skip: Skip, swiftName: string): NativePointer {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

function ptrValue(p: NativePointer): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writePointer(p);
  return cell;
}

function existentialMetadata(skip: Skip, accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(skip, accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

function store(skip: Skip, fn: string, metadata: Metadata): NativePointer {
  const RawPointer = Swift.metadataFor("Swift.UnsafeMutableRawPointer")!;
  const container = Memory.alloc(metadata.typeLayout.stride);
  makeSwiftNativeFunction(fixtureFn(skip, fn), null, [RawPointer])(ptrValue(container));
  return container;
}

describe("readValue existential", () => {
  test("decodes an inline value type from an Any container", ({ skip }) => {
    const Any_ = existentialMetadata(skip, "fixture.anyType");
    expect(existentialRepresentation(Any_)).toBe("opaque");
    expect(readValue(Any_, store(skip, "fixture.storeAnyInt", Any_))).toBe(42);
  });

  test("decodes an out-of-line (boxed) value type from an Any container", ({ skip }) => {
    const Any_ = existentialMetadata(skip, "fixture.anyType");
    expect(readValue(Any_, store(skip, "fixture.storeAnyBig", Any_))).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
    });
  });

  test("decodes a value type behind a protocol existential", ({ skip }) => {
    const Greeter = existentialMetadata(skip, "fixture.greeterType");
    expect(existentialRepresentation(Greeter)).toBe("opaque");
    expect(readValue(Greeter, store(skip, "fixture.storeGreeter", Greeter))).toEqual({
      name: "Ada",
    });
  });

  test("decodes a class reference from a class-constrained existential", ({ skip }) => {
    const Named = existentialMetadata(skip, "fixture.namedType");
    expect(existentialRepresentation(Named)).toBe("class");
    const ref = readValue(Named, store(skip, "fixture.storeNamed", Named)) as NativePointer;
    expect(ref.isNull()).toBe(false);
    expect(readObject(ref)).toEqual({ label: "Bee" });
  });
});
