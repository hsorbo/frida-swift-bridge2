import { test, expect, describe } from "@frida/injest/agent";
import { loadFixtureSyms } from "./fixtures/load.js";
import { requireSwift } from "./swift.js";

import { Swift, Metadata, Protocol, projectExistentialValue, BoundAsyncMethod } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function fixtureFn(mod: Module, swiftName: string): NativePointer {
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

function existentialMetadata(mod: Module, accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureFn(mod, accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

function store(mod: Module, fn: string, metadata: Metadata): NativePointer {
  const RawPointer = Swift.metadataFor("Swift.UnsafeMutableRawPointer")!;
  const container = Memory.alloc(metadata.typeLayout.stride);
  makeSwiftNativeFunction(fixtureFn(mod, fn), null, [RawPointer])(ptrValue(container));
  return container;
}

describe("async witness-table method invocation", () => {
  test("awaits an async protocol requirement by name (TripleScaler : AsyncScaler)", async () => {
    requireSwift();
    const mod = loadFixtureSyms();
    const AsyncScaler = existentialMetadata(mod, "fixturesyms.asyncScalerType");
    const container = store(mod, "fixturesyms.storeAsyncScaler", AsyncScaler);
    const { type, value } = projectExistentialValue(AsyncScaler, container);

    const proto = Protocol.find("fixturesyms.AsyncScaler")!;
    const table = proto.conformanceFor(type)!;
    const bound = table.method(value, "scaled");
    expect(bound instanceof BoundAsyncMethod).toBe(true);
    expect(await (bound as BoundAsyncMethod).call(7)).toBe(21);
  });
});
