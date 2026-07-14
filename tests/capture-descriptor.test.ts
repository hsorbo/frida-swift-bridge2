import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { arenaAlloc, arenaString } from "./arena.js";

import {
  CaptureDescriptor,
  captureDescriptorOf,
  offsetToFirstCapture,
  resolveCaptureType,
} from "../src/abi/capture-descriptor.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { fixtureExport } from "./fixtures/load.js";

const HEAP_LOCAL_VARIABLE = 0x400;

function writeRelativeDirectPointer(field: NativePointer, target: NativePointer): void {
  field.writeS32(target.sub(field).toInt32());
}

describe("capture descriptor", () => {
  test("enumerates capture type records", () => {
    const descriptor = arenaAlloc(0x14);
    descriptor.writeU32(2);
    descriptor.add(0x4).writeU32(0);
    descriptor.add(0x8).writeU32(0);

    const intName = arenaString("Si");
    const stringName = arenaString("SS");
    writeRelativeDirectPointer(descriptor.add(0xc), intName);
    writeRelativeDirectPointer(descriptor.add(0x10), stringName);

    const cd = new CaptureDescriptor(descriptor);
    expect(cd.numCaptureTypes).toBe(2);
    expect(cd.numMetadataSources).toBe(0);
    expect(cd.numBindings).toBe(0);

    const captures = cd.captureTypes;
    expect(captures.length).toBe(2);
    expect(captures[0].mangledTypeName!.address.equals(intName)).toBeTruthy();
    expect(captures[0].mangledTypeName!.length).toBe(2);
    expect(captures[1].mangledTypeName!.address.equals(stringName)).toBeTruthy();
  });

  test("enumerates metadata source records following the capture types", () => {
    const descriptor = arenaAlloc(0x18);
    descriptor.writeU32(1);
    descriptor.add(0x4).writeU32(1);
    descriptor.add(0x8).writeU32(1);

    const captureName = arenaString("x");
    writeRelativeDirectPointer(descriptor.add(0xc), captureName);

    const sourceTypeName = arenaString("x");
    const sourceMangling = arenaString("A");
    writeRelativeDirectPointer(descriptor.add(0x10), sourceTypeName);
    writeRelativeDirectPointer(descriptor.add(0x14), sourceMangling);

    const cd = new CaptureDescriptor(descriptor);
    expect(cd.numBindings).toBe(1);
    const sources = cd.metadataSources;
    expect(sources.length).toBe(1);
    expect(sources[0].mangledTypeName!.address.equals(sourceTypeName)).toBeTruthy();
    expect(sources[0].mangledMetadataSource!.address.equals(sourceMangling)).toBeTruthy();
  });

  test("captureDescriptorOf returns null for a context-free closure", () => {
    expect(captureDescriptorOf(ptr(0))).toBeNull();
  });

  test("captureDescriptorOf returns null for a non-closure heap object", () => {
    const metadata = Memory.alloc(0x8);
    metadata.writeU64(uint64(MetadataKind.Class));
    const context = Memory.alloc(Process.pointerSize);
    context.writePointer(metadata);
    expect(captureDescriptorOf(context)).toBeNull();
  });

  test("captureDescriptorOf resolves a HeapLocalVariable context's descriptor", () => {
    const captureDescriptor = Memory.alloc(0xc);
    captureDescriptor.writeU32(0);
    captureDescriptor.add(0x4).writeU32(0);
    captureDescriptor.add(0x8).writeU32(0);

    const metadata = Memory.alloc(0x18);
    metadata.writeU64(uint64(HEAP_LOCAL_VARIABLE));
    metadata.add(0x8).writeU32(0x20);
    metadata.add(0x10).writePointer(captureDescriptor);

    const context = Memory.alloc(Process.pointerSize);
    context.writePointer(metadata);

    const cd = captureDescriptorOf(context);
    expect(cd).not.toBeNull();
    expect(cd!.handle.equals(captureDescriptor)).toBeTruthy();
    expect(offsetToFirstCapture(context)).toBe(0x20);
  });

  test("captureDescriptorOf returns null for a generic heap-box context", () => {
    const metadata = Memory.alloc(0x8);
    metadata.writeU64(uint64(MetadataKind.HeapGenericLocalVariable));
    const context = Memory.alloc(Process.pointerSize);
    context.writePointer(metadata);
    expect(captureDescriptorOf(context)).toBeNull();
  });

  test("captureDescriptorOf returns null when CaptureDescription is null", () => {
    const metadata = Memory.alloc(0x18);
    metadata.writeU64(uint64(HEAP_LOCAL_VARIABLE));
    metadata.add(0x8).writeU32(0x18);
    metadata.add(0x10).writePointer(ptr(0));

    const context = Memory.alloc(Process.pointerSize);
    context.writePointer(metadata);

    expect(captureDescriptorOf(context)).toBeNull();
  });

  // an escaping closure is boxed behind a reabstraction thunk whose sole capture is the real closure.
  test("resolves the capture types of a real closure against the live runtime", () => {
    requireSwift();
    const storeCapturing = new NativeFunction(fixtureExport("storeCapturing"), "void", ["int64"]);
    const capturingContext = new NativeFunction(fixtureExport("capturingContext"), "pointer", []);

    storeCapturing(7);
    const outerContext = capturingContext() as NativePointer;

    const outerDescriptor = captureDescriptorOf(outerContext);
    expect(outerDescriptor).not.toBeNull();
    expect(outerDescriptor!.numBindings).toBe(0);
    expect(outerDescriptor!.numCaptureTypes).toBe(1);

    const offset = offsetToFirstCapture(outerContext);
    const innerContext = outerContext.add(offset).add(Process.pointerSize).readPointer();

    const innerDescriptor = captureDescriptorOf(innerContext);
    expect(innerDescriptor).not.toBeNull();
    expect(innerDescriptor!.numBindings).toBe(0);

    const resolvedNames = innerDescriptor!.captureTypes
      .map((record) => resolveCaptureType(record))
      .map((metadata) => metadata?.description.fullTypeName ?? null);

    expect(resolvedNames).toContain("Swift.Int");
    expect(resolvedNames).toContain("Swift.String");
  });
});
