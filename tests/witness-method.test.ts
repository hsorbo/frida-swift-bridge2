import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Metadata,
  Protocol,
  projectExistentialValue,
  readProtocolRequirements,
  bindWitnessMethodAt,
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

describe("witness-table method invocation", () => {
  test("calls a value-existential requirement by name (opaque, PoliteGreeter : Greeter)", () => {
    loadFixture();
    const Greeter = existentialMetadata("fixture.greeterType");
    const container = store("fixture.storeGreeter", Greeter);
    const { type, value } = projectExistentialValue(Greeter, container);

    const greeter = Protocol.find("fixture.Greeter")!;
    const table = greeter.conformanceFor(type)!;
    expect(table.method(value, "greet").call()).toBe("Hello, Ada");
  });

  test("reads a class-existential requirement by name (Widget : Named)", () => {
    loadFixture();
    const Named = existentialMetadata("fixture.namedType");
    const container = store("fixture.storeNamed", Named);
    const { type, value } = projectExistentialValue(Named, container);

    const named = Protocol.find("fixture.Named")!;
    const table = named.conformanceFor(type)!;
    expect(table.get(value, "label")).toBe("Bee");
  });

  test("dispatches one concrete value through two unrelated protocols (Person : Greeter, Aged)", () => {
    loadFixture();
    const GreeterAged = existentialMetadata("fixture.greeterAgedType");
    const make = makeSwiftNativeFunction(fixtureFn("fixture.makeGreeterAged"), GreeterAged, []);
    const container = make()!;
    const { type, value } = projectExistentialValue(GreeterAged, container);

    const greeter = Protocol.find("fixture.Greeter")!;
    const aged = Protocol.find("fixture.Aged")!;
    expect(greeter.conformanceFor(type)!.method(value, "greet").call()).toBe("Hi, Cy");
    expect(aged.conformanceFor(type)!.get(value, "age")).toBe(9);
  });

  test("unknown requirement name throws", () => {
    loadFixture();
    const Greeter = existentialMetadata("fixture.greeterType");
    const container = store("fixture.storeGreeter", Greeter);
    const { type, value } = projectExistentialValue(Greeter, container);

    const greeter = Protocol.find("fixture.Greeter")!;
    const table = greeter.conformanceFor(type)!;
    expect(() => table.method(value, "bogus")).toThrow(/no requirement/);
  });

  test("bindWitnessMethodAt invokes a requirement slot with a manually-supplied signature", () => {
    loadFixture();
    const Greeter = existentialMetadata("fixture.greeterType");
    const container = store("fixture.storeGreeter", Greeter);
    const { type, value } = projectExistentialValue(Greeter, container);

    const greeter = Protocol.find("fixture.Greeter")!;
    const table = greeter.conformanceFor(type)!;
    const witnessIndex = readProtocolRequirements(greeter.descriptor)[0].witnessIndex;
    const String_ = Swift.metadataFor("Swift.String")!;
    const bound = bindWitnessMethodAt(table, witnessIndex, value, { argTypes: [], returnType: String_ });
    expect(bound.call()).toBe("Hello, Ada");
  });
});
