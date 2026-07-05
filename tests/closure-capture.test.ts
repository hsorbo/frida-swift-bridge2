import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { readObject } from "../src/abi/instance.js";
import { layoutCaptures, readCaptures, unwrapReabstractionThunk, writeCaptures } from "../src/abi/closure-capture.js";
import { captureDescriptorOf, offsetToFirstCapture } from "../src/abi/capture-descriptor.js";
import { resolveTypeByMangledName } from "../src/abi/field-descriptor.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { loadFixture } from "./fixtures/load.js";

const HEAP_LOCAL_VARIABLE = 0x400;
const NOT_A_CLOSURE = 0x0;

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

function writeRelativeDirectPointer(field: NativePointer, target: NativePointer): void {
  field.writeS32(target.sub(field).toInt32());
}

// keeps helper-allocated buffers from being GC'd once their local variable goes out of scope.
const pinned: NativePointer[] = [];

function makeCaptureDescriptor(mangledNames: NativePointer[], numBindings = 0): NativePointer {
  const descriptor = Memory.alloc(0xc + mangledNames.length * 0x4);
  descriptor.writeU32(mangledNames.length);
  descriptor.add(0x4).writeU32(0);
  descriptor.add(0x8).writeU32(numBindings);
  mangledNames.forEach((name, i) => writeRelativeDirectPointer(descriptor.add(0xc + i * 0x4), name));
  pinned.push(descriptor);
  return descriptor;
}

function makeHeapContext(captureDescriptor: NativePointer, offset: number): NativePointer {
  const metadata = Memory.alloc(0x18);
  metadata.writeU64(uint64(HEAP_LOCAL_VARIABLE));
  metadata.add(0x8).writeU32(offset);
  metadata.add(0x10).writePointer(captureDescriptor);

  const context = Memory.alloc(offset + 0x20);
  context.writePointer(metadata);
  pinned.push(metadata, context);
  return context;
}

describe("closure capture layout (synthetic)", () => {
  test("computes capture addresses via align-and-place, not concatenation", () => {
    requireSwift();
    const boolName = Memory.allocUtf8String("Sb");
    const intName = Memory.allocUtf8String("Si");
    expect(resolveTypeByMangledName({ address: boolName, length: 2 })).not.toBeNull();
    expect(resolveTypeByMangledName({ address: intName, length: 2 })).not.toBeNull();
    const context = makeHeapContext(makeCaptureDescriptor([boolName, intName]), 0x10);
    const descriptor = captureDescriptorOf(context);
    expect(descriptor).not.toBeNull();
    expect(descriptor!.numCaptureTypes).toBe(2);
    expect(offsetToFirstCapture(context)).toBe(0x10);

    const slots = layoutCaptures(context);
    expect(slots).not.toBeNull();
    expect(slots!.length).toBe(2);
    expect(slots![0].type.description.fullTypeName).toBe("Swift.Bool");
    expect(slots![1].type.description.fullTypeName).toBe("Swift.Int");
    expect(slots![0].address.equals(context.add(0x10))).toBeTruthy();
    expect(slots![1].address.sub(slots![0].address).toInt32()).toBe(8);
  });

  test("returns null for a generic-bound closure without attempting to resolve it", () => {
    const intName = Memory.allocUtf8String("Si");
    const context = makeHeapContext(makeCaptureDescriptor([intName], 1), 0x10);
    expect(layoutCaptures(context)).toBeNull();
  });

  test("returns null when a capture's mangled name does not resolve", () => {
    requireSwift();
    const garbage = Memory.allocUtf8String("ZZZ_not_a_real_type");
    const context = makeHeapContext(makeCaptureDescriptor([garbage]), 0x10);
    context.add(0x10).add(Process.pointerSize).writePointer(ptr(0));
    expect(layoutCaptures(context)).toBeNull();
  });

  test("returns an empty array for a closure with no captures", () => {
    const context = makeHeapContext(makeCaptureDescriptor([]), 0x10);
    expect(layoutCaptures(context)).toEqual([]);
  });

  // a bare class-reference capture has no CaptureDescriptor of its own; see layoutSoleClassCapture.
  test("finds a class reference held directly in place of a nested closure box", () => {
    const classMetadata = Memory.alloc(0x8);
    classMetadata.writeU64(uint64(MetadataKind.Class));
    const instance = Memory.alloc(Process.pointerSize);
    instance.writePointer(classMetadata);
    pinned.push(classMetadata, instance);

    const context = makeHeapContext(makeCaptureDescriptor([Memory.allocUtf8String("garbage")]), 0x10);
    context.add(0x10).add(Process.pointerSize).writePointer(instance);

    const slots = layoutCaptures(context);
    expect(slots).not.toBeNull();
    expect(slots!.length).toBe(1);
    expect(slots![0].type.kind).toBe(MetadataKind.Class);
    expect(slots![0].address.readPointer().equals(instance)).toBeTruthy();
  });
});

describe("reabstraction-thunk unwrap (synthetic)", () => {
  test("finds the inner closure behind a one-capture, zero-binding wrapper", () => {
    const innerContext = makeHeapContext(makeCaptureDescriptor([Memory.allocUtf8String("Si")]), 0x10);
    const outerContext = makeHeapContext(makeCaptureDescriptor([Memory.allocUtf8String("garbage")]), 0x10);
    outerContext.add(0x10).add(Process.pointerSize).writePointer(innerContext);

    const inner = unwrapReabstractionThunk(outerContext);
    expect(inner).not.toBeNull();
    expect(inner!.equals(innerContext)).toBeTruthy();
  });

  test("returns null for a two-capture descriptor (not wrapper-shaped)", () => {
    const outerContext = makeHeapContext(
      makeCaptureDescriptor([Memory.allocUtf8String("a"), Memory.allocUtf8String("b")]),
      0x10
    );
    expect(unwrapReabstractionThunk(outerContext)).toBeNull();
  });

  test("returns null when the sole capture's second word is not a closure context", () => {
    const notAClosureMetadata = Memory.alloc(0x8);
    notAClosureMetadata.writeU64(uint64(NOT_A_CLOSURE));
    const notAClosureContext = Memory.alloc(Process.pointerSize);
    notAClosureContext.writePointer(notAClosureMetadata);

    const outerContext = makeHeapContext(makeCaptureDescriptor([Memory.allocUtf8String("garbage")]), 0x10);
    outerContext.add(0x10).add(Process.pointerSize).writePointer(notAClosureContext);

    expect(unwrapReabstractionThunk(outerContext)).toBeNull();
  });
});

describe("closure capture values (live runtime)", () => {
  test("readCaptures resolves through the reabstraction thunk automatically", () => {
    requireSwift();
    const storeCapturing = new NativeFunction(fixtureFn("storeCapturing"), "void", ["int64"]);
    const capturingContext = new NativeFunction(fixtureFn("capturingContext"), "pointer", []);

    storeCapturing(7);
    const context = capturingContext() as NativePointer;

    expect(readCaptures(context)).toEqual([7, "-fixture"]);
  });

  test("decodes a captured struct", () => {
    requireSwift();
    const storeStructCapturing = new NativeFunction(fixtureFn("storeStructCapturing"), "void", [
      "int64",
      "int64",
      "int64",
      "int64",
    ]);
    const structCapturingContext = new NativeFunction(fixtureFn("structCapturingContext"), "pointer", []);

    storeStructCapturing(1, 2, 3, 4);
    const context = structCapturingContext() as NativePointer;

    expect(readCaptures(context)).toEqual([{ a: 1, b: 2, c: 3, d: 4 }]);
  });

  test("decodes a captured class reference", () => {
    requireSwift();
    const storeClassCapturing = new NativeFunction(fixtureFn("storeClassCapturing"), "void", ["int64"]);
    const classCapturingContext = new NativeFunction(fixtureFn("classCapturingContext"), "pointer", []);

    storeClassCapturing(42);
    const context = classCapturingContext() as NativePointer;

    const values = readCaptures(context);
    expect(values).not.toBeNull();
    expect(readObject(values![0] as NativePointer)).toEqual({ kind: 42 });
  });

  test("agrees on offsets and values for a mixed Bool/Int/class capture list", () => {
    requireSwift();
    const storeMixedCapturing = new NativeFunction(fixtureFn("storeMixedCapturing"), "void", [
      "int64",
      "int64",
      "int64",
    ]);
    const mixedCapturingContext = new NativeFunction(fixtureFn("mixedCapturingContext"), "pointer", []);

    storeMixedCapturing(1, 5, 9);
    const context = mixedCapturingContext() as NativePointer;

    const slots = layoutCaptures(context);
    expect(slots).not.toBeNull();
    expect(slots!.length).toBe(3);
    expect(slots![1].address.sub(slots![0].address).toInt32()).toBe(8);
    expect(slots![2].address.sub(slots![1].address).toInt32()).toBe(8);

    const values = readCaptures(context)!;
    expect(values[0]).toBe(true);
    expect(values[1]).toBe(5);
    expect(readObject(values[2] as NativePointer)).toEqual({ kind: 9 });
  });

  test("returns null for a closure whose captures depend on a generic parameter", () => {
    requireSwift();
    const triggerGenericCapturing = new NativeFunction(fixtureFn("triggerGenericCapturing"), "void", []);
    const genericCapturingContext = new NativeFunction(fixtureFn("genericCapturingContext"), "pointer", []);

    triggerGenericCapturing();
    const context = genericCapturingContext() as NativePointer;

    expect(readCaptures(context)).toBeNull();
  });

  test("writeCaptures mutates a live closure, observable through a real Swift call", () => {
    requireSwift();
    const storeCapturing = new NativeFunction(fixtureFn("storeCapturing"), "void", ["int64"]);
    const capturingContext = new NativeFunction(fixtureFn("capturingContext"), "pointer", []);
    const invokeCapturing = new NativeFunction(fixtureFn("invokeCapturing"), "int64", ["int64"]);

    storeCapturing(7);
    const context = capturingContext() as NativePointer;

    writeCaptures(context, [100, "hi"]);

    expect(invokeCapturing(5).toNumber()).toBe(107);
  });

  test("writeCaptures throws on a value-count mismatch", () => {
    requireSwift();
    const storeCapturing = new NativeFunction(fixtureFn("storeCapturing"), "void", ["int64"]);
    const capturingContext = new NativeFunction(fixtureFn("capturingContext"), "pointer", []);

    storeCapturing(7);
    const context = capturingContext() as NativePointer;

    expect(() => writeCaptures(context, [1])).toThrow();
  });

  test("writeCaptures correctly assigns a heap-allocated (non-inline) String capture", () => {
    requireSwift();
    const storeCapturing = new NativeFunction(fixtureFn("storeCapturing"), "void", ["int64"]);
    const capturingContext = new NativeFunction(fixtureFn("capturingContext"), "pointer", []);
    const invokeCapturing = new NativeFunction(fixtureFn("invokeCapturing"), "int64", ["int64"]);

    storeCapturing(7);
    const context = capturingContext() as NativePointer;

    const longSuffix = "a string well past the small-string inline capacity of fifteen bytes";
    writeCaptures(context, [100, longSuffix]);
    expect(invokeCapturing(5).toNumber()).toBe(100 + 5 + longSuffix.length);

    const anotherLongSuffix = "and now overwritten with a second, differently-sized heap string";
    writeCaptures(context, [1, anotherLongSuffix]);
    expect(invokeCapturing(5).toNumber()).toBe(1 + 5 + anotherLongSuffix.length);
  });

  test("writeCaptures rejects a class-typed capture without mutating any slot", () => {
    requireSwift();
    const storeMixedCapturing = new NativeFunction(fixtureFn("storeMixedCapturing"), "void", [
      "int64",
      "int64",
      "int64",
    ]);
    const mixedCapturingContext = new NativeFunction(fixtureFn("mixedCapturingContext"), "pointer", []);

    storeMixedCapturing(1, 5, 9);
    const context = mixedCapturingContext() as NativePointer;
    const before = readCaptures(context)!;

    expect(() => writeCaptures(context, [false, 6, ptr(0)])).toThrow();

    const after = readCaptures(context)!;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect((after[2] as NativePointer).equals(before[2] as NativePointer)).toBeTruthy();
  });
});
