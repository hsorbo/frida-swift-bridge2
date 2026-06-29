import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Metadata, readValue, readString } from "../src/index.js";
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

function intArg(n: number): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writeS64(n);
  return cell;
}

function existentialMetadata(accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

describe("existential by-value calling convention", () => {
  test("returns then accepts Any by value (opaque, address-only → indirect)", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Any_ = existentialMetadata("fixture.anyType");
    const box = makeSwiftNativeFunction(fixtureFn("fixture.boxAnyInt"), Any_, [Int]);
    const any = box(intArg(42))!;
    expect(readValue(Any_, any)).toBe(42);
    const unbox = makeSwiftNativeFunction(fixtureFn("fixture.unboxAnyInt"), Int, [Any_]);
    expect(unbox(any)!.readS64().toNumber()).toBe(42);
  });

  test("returns then accepts a protocol existential by value (indirect, witness-table container)", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const Greeter = existentialMetadata("fixture.greeterType");
    const make = makeSwiftNativeFunction(fixtureFn("fixture.makeGreeterExistential"), Greeter, []);
    const g = make()!;
    expect(readValue(Greeter, g)).toEqual({ name: "Ada" });
    const greet = makeSwiftNativeFunction(fixtureFn("fixture.greetExistential"), String_, [Greeter]);
    expect(readString(greet(g)!)).toBe("Hello, Ada");
  });
});
