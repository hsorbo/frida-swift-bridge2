import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Metadata, readValue, readString } from "../src/index.js";
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

function intArg(n: number): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writeS64(n);
  return cell;
}

function existentialMetadata(skip: Skip, accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(skip, accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

describe("existential by-value calling convention", () => {
  test("returns then accepts Any by value (opaque, address-only → indirect)", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Any_ = existentialMetadata(skip, "fixture.anyType");
    const box = makeSwiftNativeFunction(fixtureFn(skip, "fixture.boxAnyInt"), Any_, [Int]);
    const any = box(intArg(42))!;
    expect(readValue(Any_, any)).toBe(42);
    const unbox = makeSwiftNativeFunction(fixtureFn(skip, "fixture.unboxAnyInt"), Int, [Any_]);
    expect(unbox(any)!.readS64().toNumber()).toBe(42);
  });

  test("returns then accepts a protocol existential by value (indirect, witness-table container)", ({
    skip,
  }) => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const Greeter = existentialMetadata(skip, "fixture.greeterType");
    const make = makeSwiftNativeFunction(fixtureFn(skip, "fixture.makeGreeterExistential"), Greeter, []);
    const g = make()!;
    expect(readValue(Greeter, g)).toEqual({ name: "Ada" });
    const greet = makeSwiftNativeFunction(fixtureFn(skip, "fixture.greetExistential"), String_, [Greeter]);
    expect(readString(greet(g)!)).toBe("Hello, Ada");
  });
});
