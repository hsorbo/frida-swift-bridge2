import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Metadata,
  readValue,
  readObject,
  existentialRepresentation,
} from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureFn(swiftName: string): NativePointer {
  const mod = loadFixture();
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

function existentialMetadata(accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

function store(fn: string, metadata: Metadata): NativePointer {
  const RawPointer = Swift.metadataFor("Swift.UnsafeMutableRawPointer")!;
  const container = Memory.alloc(metadata.typeLayout.stride);
  makeSwiftNativeFunction(fixtureFn(fn), null, [RawPointer])(ptrValue(container));
  return container;
}

describe("readValue existential", () => {
  test("decodes an inline value type from an Any container", () => {
    const Any_ = existentialMetadata("fixture.anyType");
    expect(existentialRepresentation(Any_)).toBe("opaque");
    expect(readValue(Any_, store("fixture.storeAnyInt", Any_))).toBe(42);
  });

  test("decodes an out-of-line (boxed) value type from an Any container", () => {
    const Any_ = existentialMetadata("fixture.anyType");
    expect(readValue(Any_, store("fixture.storeAnyBig", Any_))).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
    });
  });

  test("decodes a value type behind a protocol existential", () => {
    const Greeter = existentialMetadata("fixture.greeterType");
    expect(existentialRepresentation(Greeter)).toBe("opaque");
    expect(readValue(Greeter, store("fixture.storeGreeter", Greeter))).toEqual({
      name: "Ada",
    });
  });

  test("decodes a class reference from a class-constrained existential", () => {
    const Named = existentialMetadata("fixture.namedType");
    expect(existentialRepresentation(Named)).toBe("class");
    const ref = readValue(Named, store("fixture.storeNamed", Named)) as NativePointer;
    expect(ref.isNull()).toBe(false);
    expect(readObject(ref)).toEqual({ label: "Bee" });
  });

  test("decodes the boxed value behind an Error existential", () => {
    const Error_ = existentialMetadata("fixture.errorType");
    expect(existentialRepresentation(Error_)).toBe("error");
    expect(readValue(Error_, store("fixture.storeError", Error_))).toEqual({ code: 7 });
  });
});
