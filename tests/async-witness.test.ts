import { test, expect, describe } from "@frida/injest/agent";
import { loadFixtureSyms, fixtureExport, existentialMetadata } from "./fixtures/load.js";
import { requireSwift } from "./swift.js";

import { Swift, Metadata, Protocol, projectExistentialValue, BoundAsyncMethod } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function ptrValue(p: NativePointer): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writePointer(p);
  return cell;
}

function store(mod: Module, fn: string, metadata: Metadata): NativePointer {
  const RawPointer = Swift.metadataFor("Swift.UnsafeMutableRawPointer")!;
  const container = Memory.alloc(metadata.typeLayout.stride);
  makeSwiftNativeFunction(fixtureExport(fn, mod), null, [RawPointer])(ptrValue(container));
  return container;
}

describe("async witness-table method invocation", () => {
  test("awaits an async protocol requirement by name (TripleScaler : AsyncScaler)", async () => {
    requireSwift();
    const mod = loadFixtureSyms();
    const AsyncScaler = existentialMetadata("fixturesyms.asyncScalerType", mod);
    const container = store(mod, "fixturesyms.storeAsyncScaler", AsyncScaler);
    const { type, value } = projectExistentialValue(AsyncScaler, container);

    const proto = Protocol.find("fixturesyms.AsyncScaler")!;
    const table = proto.conformanceFor(type)!;
    const bound = table.method(value, "scaled");
    expect(bound instanceof BoundAsyncMethod).toBe(true);
    expect(await (bound as BoundAsyncMethod).call(7)).toBe(21);
  });
});
