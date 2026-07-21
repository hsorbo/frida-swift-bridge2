import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { extendedContextName, extendedTypeName } from "../src/abi/extension-context-descriptor.js";
import { arenaAlloc, arenaString, writeRelativeDirectPointer } from "./arena.js";

describe("extension context descriptor", () => {
  test("resolves the mangled name of the extended type", () => {
    const descriptor = arenaAlloc(0xc);
    descriptor.writeU32(ContextDescriptorKind.Extension);
    descriptor.add(0x4).writeS32(0);

    const mangledName = arenaString("Si");
    writeRelativeDirectPointer(descriptor.add(0x8), mangledName);

    const ctx = new ContextDescriptor(descriptor);
    expect(ctx.kind).toBe(ContextDescriptorKind.Extension);

    const name = extendedContextName(ctx);
    expect(name).not.toBeNull();
    expect(name!.address.equals(mangledName)).toBeTruthy();
    expect(name!.length).toBe(2);
  });

  test("a nested type under an ordinary (non-symbolic) extension mangling resolves by demangling", () => {
    const module = arenaAlloc(0xc);
    module.writeU32(ContextDescriptorKind.Module);
    module.add(0x4).writeS32(0);
    writeRelativeDirectPointer(module.add(0x8), arenaString("M"));

    const extension = arenaAlloc(0xc);
    extension.writeU32(ContextDescriptorKind.Extension);
    writeRelativeDirectPointer(extension.add(0x4), module);
    writeRelativeDirectPointer(extension.add(0x8), arenaString("Si"));

    const nested = arenaAlloc(0xc);
    nested.writeU32(ContextDescriptorKind.Struct);
    writeRelativeDirectPointer(nested.add(0x4), extension);
    writeRelativeDirectPointer(nested.add(0x8), arenaString("Inner"));

    // Not a symbolic reference, so the descriptor path yields nothing; the mangling demangles instead.
    expect(new ContextDescriptor(extension).extendedTypeDescriptor).toBeNull();
    expect(new ContextDescriptor(nested).fullTypeName).toBe("Swift.Int.Inner");
  });

  test("bails without throwing on a mixed text + symbolic-reference mangling", () => {
    // Real shape from PromptKit's `extension Array<...>`: "Say" then a symbolic reference then "G"
    // (bytes 53 61 79 01 a4 bf 00 00 47). The leading "S" is not a symbolic ref, so the descriptor
    // path returns null; the embedded 01/high bytes are not valid UTF-8 and once threw here.
    const module = arenaAlloc(0xc);
    module.writeU32(ContextDescriptorKind.Module);
    module.add(0x4).writeS32(0);
    writeRelativeDirectPointer(module.add(0x8), arenaString("M"));

    const mangled = arenaAlloc(0x10);
    mangled.writeByteArray([0x53, 0x61, 0x79, 0x01, 0xa4, 0xbf, 0x00, 0x00, 0x47, 0x00]);

    const extension = arenaAlloc(0xc);
    extension.writeU32(ContextDescriptorKind.Extension);
    writeRelativeDirectPointer(extension.add(0x4), module);
    writeRelativeDirectPointer(extension.add(0x8), mangled);

    const nested = arenaAlloc(0xc);
    nested.writeU32(ContextDescriptorKind.Struct);
    writeRelativeDirectPointer(nested.add(0x4), extension);
    writeRelativeDirectPointer(nested.add(0x8), arenaString("Inner"));

    const ext = new ContextDescriptor(extension);
    expect(ext.extendedTypeDescriptor).toBeNull();
    expect(extendedTypeName(ext)).toBeNull();
    expect(new ContextDescriptor(nested).fullTypeName).toBeNull();
  });

  test("returns null for a zero ExtendedContext offset", () => {
    const descriptor = Memory.alloc(0xc);
    descriptor.writeU32(ContextDescriptorKind.Extension);
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeS32(0);

    expect(extendedContextName(new ContextDescriptor(descriptor))).toBeNull();
  });
});
