import { test, expect, describe } from "@frida/injest/agent";
import { requireDarwin } from "./swift.js";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { TypeReferenceKind } from "../src/abi/class-descriptor.js";
import { getClassMetadataBounds } from "../src/abi/class-metadata-bounds.js";

const CLASS_HAS_RESILIENT_SUPERCLASS = 1 << 13;
const CLASS_RESILIENT_SUPERCLASS_REFERENCE_KIND_SHIFT = 9;

function writeRelativeDirectPointer(field: NativePointer, target: NativePointer): void {
  field.writeS32(target.sub(field).toInt32());
}

function classDescriptorFlags(referenceKind: TypeReferenceKind): number {
  const kindFlags =
    CLASS_HAS_RESILIENT_SUPERCLASS | (referenceKind << CLASS_RESILIENT_SUPERCLASS_REFERENCE_KIND_SHIFT);
  return (kindFlags << 16) | ContextDescriptorKind.Class;
}

describe("class metadata bounds", () => {
  test("resilient superclass bottoming at a plain ObjC ancestor gets root-class bounds", (ctx) => {
    requireDarwin(ctx);

    const objcAncestor = Memory.alloc(0x30); // Data field left 0: not Swift type metadata
    const storage = Memory.alloc(Process.pointerSize);
    storage.writePointer(objcAncestor);

    const descriptor = Memory.alloc(0x30);
    descriptor.writeU32(classDescriptorFlags(TypeReferenceKind.IndirectObjCClass));
    writeRelativeDirectPointer(descriptor.add(0x2c), storage);

    const bounds = getClassMetadataBounds(new ContextDescriptor(descriptor));
    expect(bounds.negativeSizeInWords).toBe(3); // TargetHeapMetadataHeader, per forSwiftRootClass()
    expect(bounds.positiveSizeInWords).toBeGreaterThan(0);
  });

  test("a resilient class with no formal superclass reference gets root-class bounds", () => {
    const descriptor = Memory.alloc(0x30);
    descriptor.writeU32(classDescriptorFlags(TypeReferenceKind.DirectTypeDescriptor));
    descriptor.add(0x2c).writeS32(0); // null relative pointer: no formal superclass

    const bounds = getClassMetadataBounds(new ContextDescriptor(descriptor));
    expect(bounds.negativeSizeInWords).toBe(3);
    expect(bounds.positiveSizeInWords).toBeGreaterThan(0);
  });

  test("resilient superclass reference by ObjC class name resolves via objc_lookUpClass", (ctx) => {
    requireDarwin(ctx);

    const descriptor = Memory.alloc(0x30);
    descriptor.writeU32(classDescriptorFlags(TypeReferenceKind.DirectObjCClassName));
    const className = Memory.allocUtf8String("NSObject");
    writeRelativeDirectPointer(descriptor.add(0x2c), className);

    const bounds = getClassMetadataBounds(new ContextDescriptor(descriptor));
    expect(bounds.positiveSizeInWords).toBeGreaterThan(0);
  });

  test("resilient superclass reference by an unknown ObjC class name throws", (ctx) => {
    requireDarwin(ctx);

    const descriptor = Memory.alloc(0x30);
    descriptor.writeU32(classDescriptorFlags(TypeReferenceKind.DirectObjCClassName));
    const className = Memory.allocUtf8String("NoSuchClassXYZ");
    writeRelativeDirectPointer(descriptor.add(0x2c), className);

    expect(() => getClassMetadataBounds(new ContextDescriptor(descriptor))).toThrow();
  });
});
