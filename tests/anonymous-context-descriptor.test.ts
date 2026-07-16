import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { hasMangledName, anonymousMangledName } from "../src/abi/anonymous-context-descriptor.js";
import { arenaAlloc, arenaString, writeRelativeDirectPointer } from "./arena.js";

const FLAG_IS_GENERIC = 0x80;
const FLAG_HAS_MANGLED_NAME = 0x10000;

describe("anonymous context descriptor", () => {
  test("resolves a trailing mangled name when non-generic", () => {
    const descriptor = arenaAlloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.Anonymous | FLAG_HAS_MANGLED_NAME);
    descriptor.add(0x4).writeS32(0);

    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x8), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(hasMangledName(ctx)).toBeTruthy();
    const name = anonymousMangledName(ctx);
    expect(name).not.toBeNull();
    expect(name!.address.equals(mangledName)).toBeTruthy();
    expect(name!.length).toBe(2);
  });

  test("returns null when the mangled-name flag is unset", () => {
    const descriptor = Memory.alloc(0x10);
    descriptor.writeU32(ContextDescriptorKind.Anonymous);
    descriptor.add(0x4).writeS32(0);

    const ctx = new ContextDescriptor(descriptor);
    expect(hasMangledName(ctx)).toBeFalsy();
    expect(anonymousMangledName(ctx)).toBeNull();
  });

  test("resolves the mangled name after a zero-param, zero-requirement generic context", () => {
    const descriptor = arenaAlloc(0x14);
    descriptor.writeU32(ContextDescriptorKind.Anonymous | FLAG_IS_GENERIC | FLAG_HAS_MANGLED_NAME);
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeU16(0); // NumParams
    descriptor.add(0xa).writeU16(0); // NumRequirements

    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x10), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(ctx.isGeneric).toBeTruthy();
    const name = anonymousMangledName(ctx);
    expect(name).not.toBeNull();
    expect(name!.address.equals(mangledName)).toBeTruthy();
  });
});
