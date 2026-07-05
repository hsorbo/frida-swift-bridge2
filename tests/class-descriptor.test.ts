import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { getResilientSuperclassRef } from "../src/abi/class-descriptor.js";

const FLAG_IS_GENERIC = 0x80;
const FLAG_HAS_TYPE_PACKS = 0x1;
const CLASS_HAS_RESILIENT_SUPERCLASS = 1 << 13;

function writeRelativeDirectPointer(field: NativePointer, target: NativePointer): void {
  field.writeS32(target.sub(field).toInt32());
}

function classDescriptorFlags(isGeneric: boolean): number {
  const kindFlags = CLASS_HAS_RESILIENT_SUPERCLASS;
  return (kindFlags << 16) | ContextDescriptorKind.Class | (isGeneric ? FLAG_IS_GENERIC : 0);
}

describe("class descriptor", () => {
  test("resolves the resilient superclass ref right after the base descriptor when non-generic", () => {
    const descriptor = Memory.alloc(0x30);
    descriptor.writeU32(classDescriptorFlags(false));

    const target = Memory.alloc(0x8);
    writeRelativeDirectPointer(descriptor.add(0x2c), target);

    const ref = getResilientSuperclassRef(new ContextDescriptor(descriptor));
    expect(ref).not.toBeNull();
    expect(ref!.equals(target)).toBeTruthy();
  });

  test("resolves the resilient superclass ref past the generic context when generic", () => {
    const descriptor = Memory.alloc(0x40);
    descriptor.writeU32(classDescriptorFlags(true));
    descriptor.add(0x34).writeU16(0); // NumParams
    descriptor.add(0x36).writeU16(0); // NumRequirements

    const target = Memory.alloc(0x8);
    writeRelativeDirectPointer(descriptor.add(0x3c), target);

    const ref = getResilientSuperclassRef(new ContextDescriptor(descriptor));
    expect(ref).not.toBeNull();
    expect(ref!.equals(target)).toBeTruthy();
  });

  test("resolves the resilient superclass ref past a non-empty pack-shape section when generic", () => {
    const descriptor = Memory.alloc(0x50);
    descriptor.writeU32(classDescriptorFlags(true));
    descriptor.add(0x34).writeU16(0); // NumParams
    descriptor.add(0x36).writeU16(0); // NumRequirements
    descriptor.add(0x3a).writeU16(FLAG_HAS_TYPE_PACKS);
    descriptor.add(0x3c).writeU16(1); // PackShapeHeader.NumPacks
    descriptor.add(0x3e).writeU16(0); // PackShapeHeader.NumShapeClasses

    const target = Memory.alloc(0x8);
    writeRelativeDirectPointer(descriptor.add(0x48), target);

    const ref = getResilientSuperclassRef(new ContextDescriptor(descriptor));
    expect(ref).not.toBeNull();
    expect(ref!.equals(target)).toBeTruthy();
  });
});
