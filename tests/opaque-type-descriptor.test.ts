import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { GenericRequirementKind } from "../src/abi/generic-requirement-descriptor.js";
import {
  numUnderlyingTypeArguments,
  underlyingTypeArgumentMangledName,
  opaqueTypeRequirements,
} from "../src/abi/opaque-type-descriptor.js";

const FLAG_IS_GENERIC = 0x80;

describe("opaque type descriptor", () => {
  test("resolves a trailing underlying-type mangled name when non-generic", () => {
    const descriptor = Memory.alloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (1 << 16));
    descriptor.add(0x4).writeS32(0);

    const mangledName = Memory.allocUtf8String("Si");
    const argField = descriptor.add(0x8);
    argField.writeS32(mangledName.sub(argField).toInt32());

    const ctx = new ContextDescriptor(descriptor);
    expect(numUnderlyingTypeArguments(ctx)).toBe(1);
    const name = underlyingTypeArgumentMangledName(ctx, 0);
    expect(name.address.equals(mangledName)).toBeTruthy();
    expect(name.length).toBe(2);
  });

  test("resolves multiple underlying-type mangled names by index", () => {
    const descriptor = Memory.alloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (2 << 16));
    descriptor.add(0x4).writeS32(0);

    const name0 = Memory.allocUtf8String("Si");
    const field0 = descriptor.add(0x8);
    field0.writeS32(name0.sub(field0).toInt32());

    const name1 = Memory.allocUtf8String("Sb");
    const field1 = descriptor.add(0xc);
    field1.writeS32(name1.sub(field1).toInt32());

    const ctx = new ContextDescriptor(descriptor);
    expect(numUnderlyingTypeArguments(ctx)).toBe(2);
    expect(underlyingTypeArgumentMangledName(ctx, 0).address.equals(name0)).toBeTruthy();
    expect(underlyingTypeArgumentMangledName(ctx, 1).address.equals(name1)).toBeTruthy();
  });

  test("throws for an out-of-range underlying-type index", () => {
    const descriptor = Memory.alloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    const mangledName = Memory.allocUtf8String("Si");
    const argField = descriptor.add(0x8);
    argField.writeS32(mangledName.sub(argField).toInt32());

    const ctx = new ContextDescriptor(descriptor);
    expect(() => underlyingTypeArgumentMangledName(ctx, 1)).toThrow();
    expect(() => underlyingTypeArgumentMangledName(ctx, -1)).toThrow();
  });

  test("resolves an underlying-type mangled name after a zero-param, zero-requirement generic context", () => {
    const descriptor = Memory.alloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(0); // NumParams
    descriptor.add(0xa).writeU16(0); // NumRequirements

    const mangledName = Memory.allocUtf8String("Si");
    const argField = descriptor.add(0x10);
    argField.writeS32(mangledName.sub(argField).toInt32());

    const ctx = new ContextDescriptor(descriptor);
    expect(ctx.isGeneric).toBeTruthy();
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
    const descriptor = Memory.alloc(0x28);
    descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC | (1 << 16));
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(1); // NumParams
    descriptor.add(0xa).writeU16(1); // NumRequirements
    descriptor.add(0x10).writeU8(0);

    descriptor.add(0x14).writeU32(GenericRequirementKind.SameType);
    const paramName = Memory.allocUtf8String("x");
    const paramField = descriptor.add(0x18);
    paramField.writeS32(paramName.sub(paramField).toInt32());
    const sameTypeName = Memory.allocUtf8String("Si");
    const unionField = descriptor.add(0x1c);
    unionField.writeS32(sameTypeName.sub(unionField).toInt32());

    const underlyingName = Memory.allocUtf8String("Sb");
    const argField = descriptor.add(0x20);
    argField.writeS32(underlyingName.sub(argField).toInt32());

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
});
