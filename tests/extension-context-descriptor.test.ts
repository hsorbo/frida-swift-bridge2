import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { extendedContextName } from "../src/abi/extension-context-descriptor.js";
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

  test("returns null for a zero ExtendedContext offset", () => {
    const descriptor = Memory.alloc(0xc);
    descriptor.writeU32(ContextDescriptorKind.Extension);
    descriptor.add(0x4).writeS32(0);
    descriptor.add(0x8).writeS32(0);

    expect(extendedContextName(new ContextDescriptor(descriptor))).toBeNull();
  });
});
