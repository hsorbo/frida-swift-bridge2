import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";
import { arenaAlloc, arenaString, writeRelativeDirectPointer } from "./arena.js";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { GenericRequirementKind } from "../src/abi/generic-requirement-descriptor.js";
import {
  numUnderlyingTypeArguments,
  underlyingTypeArgumentMangledName,
  opaqueTypeRequirements,
} from "../src/abi/opaque-type-descriptor.js";

const MAKE_OPAQUE_GREETER_DESCRIPTOR = "$s7fixture17makeOpaqueGreeterQryFQOMQ";

const FLAG_IS_GENERIC = 0x80;
const FLAG_HAS_TYPE_PACKS = 0x1;

describe("opaque type descriptor", () => {
  test("resolves a trailing underlying-type mangled name when non-generic", () => {
    const descriptor = arenaAlloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (1 << 16));
    descriptor.add(0x4).writeS32(0);

    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x8), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(numUnderlyingTypeArguments(ctx)).toBe(1);
    const name = underlyingTypeArgumentMangledName(ctx, 0);
    expect(name.address.equals(mangledName)).toBeTruthy();
    expect(name.length).toBe(2);
  });

  test("resolves multiple underlying-type mangled names by index", () => {
    const descriptor = arenaAlloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (2 << 16));
    descriptor.add(0x4).writeS32(0);

    const name0 = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x8), name0);

    const name1 = arenaString("Sb");
    writeRelativeDirectPointer(descriptor.add(0xc), name1);

    const ctx = new ContextDescriptor(descriptor);
    expect(numUnderlyingTypeArguments(ctx)).toBe(2);
    expect(underlyingTypeArgumentMangledName(ctx, 0).address.equals(name0)).toBeTruthy();
    expect(underlyingTypeArgumentMangledName(ctx, 1).address.equals(name1)).toBeTruthy();
  });

  test("throws for an out-of-range underlying-type index", () => {
    const descriptor = arenaAlloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x8), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(() => underlyingTypeArgumentMangledName(ctx, 1)).toThrow();
    expect(() => underlyingTypeArgumentMangledName(ctx, -1)).toThrow();
  });

  test("resolves an underlying-type mangled name after a zero-param, zero-requirement generic context", () => {
    const descriptor = arenaAlloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(0); // NumParams
    descriptor.add(0xa).writeU16(0); // NumRequirements

    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x10), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(ctx.isGeneric).toBeTruthy();
    expect(numUnderlyingTypeArguments(ctx)).toBe(1);
    const name = underlyingTypeArgumentMangledName(ctx, 0);
    expect(name.address.equals(mangledName)).toBeTruthy();
  });

  test("resolves an underlying-type mangled name past a non-empty pack-shape section", () => {
    const descriptor = arenaAlloc(0x20);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(0); // NumParams
    descriptor.add(0xa).writeU16(0); // NumRequirements
    descriptor.add(0xe).writeU16(FLAG_HAS_TYPE_PACKS);
    descriptor.add(0x10).writeU16(1); // PackShapeHeader.NumPacks
    descriptor.add(0x12).writeU16(0); // PackShapeHeader.NumShapeClasses

    const mangledName = arenaString("Si");
    // 0x1c: past PackShapeHeader(4) + 1*PackShapeDescriptor(8)
    writeRelativeDirectPointer(descriptor.add(0x1c), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(numUnderlyingTypeArguments(ctx)).toBe(1);
    const name = underlyingTypeArgumentMangledName(ctx, 0);
    expect(name.address.equals(mangledName)).toBeTruthy();
  });

  test("returns no requirements for a non-generic opaque type", () => {
    const descriptor = Memory.alloc(0x8);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType);
    descriptor.add(0x4).writeS32(0);

    const ctx = new ContextDescriptor(descriptor);
    expect(opaqueTypeRequirements(ctx).length).toBe(0);
  });

  test("decodes the generic requirements of a generic opaque type (`some P`'s constraint)", () => {
    const descriptor = arenaAlloc(0x28);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(1); // NumParams
    descriptor.add(0xa).writeU16(1); // NumRequirements
    descriptor.add(0x10).writeU8(0);

    descriptor.add(0x14).writeU32(GenericRequirementKind.SameType);
    const paramName = arenaString("x");
    writeRelativeDirectPointer(descriptor.add(0x18), paramName);
    const sameTypeName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x1c), sameTypeName);

    const underlyingName = arenaString("Sb");
    writeRelativeDirectPointer(descriptor.add(0x20), underlyingName);

    const ctx = new ContextDescriptor(descriptor);
    const reqs = opaqueTypeRequirements(ctx);
    expect(reqs.length).toBe(1);
    expect(reqs[0].kind).toBe(GenericRequirementKind.SameType);
    expect(reqs[0].sameTypeName).not.toBeNull();
    expect(reqs[0].sameTypeName!.address.equals(sameTypeName)).toBeTruthy();

    expect(numUnderlyingTypeArguments(ctx)).toBe(1);
    const underlying = underlyingTypeArgumentMangledName(ctx, 0);
    expect(underlying.address.equals(underlyingName)).toBeTruthy();
  });

  test("reads a real compiled `some Greeter` opaque type descriptor", () => {
    const module = loadFixture();
    const ctx = new ContextDescriptor(module.getExportByName(MAKE_OPAQUE_GREETER_DESCRIPTOR));

    expect(ctx.kind).toBe(ContextDescriptorKind.OpaqueType);
    expect(ctx.isGeneric).toBeTruthy();

    const reqs = opaqueTypeRequirements(ctx);
    expect(reqs.length).toBe(1);
    expect(reqs[0].kind).toBe(GenericRequirementKind.Protocol);
    expect(reqs[0].protocol?.name).toBe("Greeter");

    expect(numUnderlyingTypeArguments(ctx)).toBe(2);
    for (let i = 0; i < 2; i++) {
      const arg = underlyingTypeArgumentMangledName(ctx, i);
      expect(arg.address.isNull()).toBeFalsy();
      expect(arg.length).toBeGreaterThan(0);
    }
  });
});
