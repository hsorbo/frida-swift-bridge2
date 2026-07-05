import { test, expect, describe } from "@frida/injest/agent";

import {
  GenericRequirementKind,
  GenericRequirementLayoutKind,
  InvertibleProtocolKind,
  readGenericRequirementDescriptors,
  GENERIC_REQUIREMENT_DESCRIPTOR_SIZE,
} from "../src/abi/generic-requirement-descriptor.js";
import { findProtocol } from "../src/abi/protocol-conformance.js";
import { loadSwiftCore } from "./swift.js";

function writeParamName(at: NativePointer, name: string): void {
  const str = Memory.allocUtf8String(name);
  at.writeS32(str.sub(at).toInt32());
}

describe("generic requirement descriptor", () => {
  test("reads a Layout requirement's class-constraint kind", () => {
    const requirement = Memory.alloc(GENERIC_REQUIREMENT_DESCRIPTOR_SIZE);
    requirement.writeU32(GenericRequirementKind.Layout);
    writeParamName(requirement.add(0x4), "A");
    requirement.add(0x8).writeU32(GenericRequirementLayoutKind.Class);

    const [entry] = readGenericRequirementDescriptors(requirement, 1);
    expect(entry.kind).toBe(GenericRequirementKind.Layout);
    expect(entry.layoutKind).toBe(GenericRequirementLayoutKind.Class);
    expect(entry.protocol).toBeNull();
    expect(entry.sameTypeName).toBeNull();
  });

  test("leaves layoutKind null for a SameType requirement", () => {
    const requirement = Memory.alloc(GENERIC_REQUIREMENT_DESCRIPTOR_SIZE);
    requirement.writeU32(GenericRequirementKind.SameType);
    writeParamName(requirement.add(0x4), "A");
    writeParamName(requirement.add(0x8), "Si");

    const [entry] = readGenericRequirementDescriptors(requirement, 1);
    expect(entry.kind).toBe(GenericRequirementKind.SameType);
    expect(entry.layoutKind).toBeNull();
    expect(entry.sameTypeName).not.toBeNull();
  });

  test("reads an InvertedProtocols requirement's param index and protocol bitset", () => {
    const requirement = Memory.alloc(GENERIC_REQUIREMENT_DESCRIPTOR_SIZE);
    requirement.writeU32(GenericRequirementKind.InvertedProtocols);
    writeParamName(requirement.add(0x4), "A");
    const union = requirement.add(0x8);
    union.writeU16(2);
    union.add(2).writeU16((1 << InvertibleProtocolKind.Copyable) | (1 << InvertibleProtocolKind.Escapable));

    const [entry] = readGenericRequirementDescriptors(requirement, 1);
    expect(entry.kind).toBe(GenericRequirementKind.InvertedProtocols);
    expect(entry.invertedProtocols).not.toBeNull();
    expect(entry.invertedProtocols!.genericParamIndex).toBe(2);
    expect(entry.invertedProtocols!.protocolBits).toBe(0b11);
    expect(entry.conformance).toBeNull();
  });

  test("resolves a SameConformance requirement's conformance descriptor", () => {
    loadSwiftCore();
    const hashable = findProtocol("Swift.Hashable")!;

    const fakeConformance = Memory.alloc(0x14);
    const protocolSlot = Memory.alloc(Process.pointerSize);
    protocolSlot.writePointer(hashable.handle);
    fakeConformance.writeS32(protocolSlot.sub(fakeConformance).toInt32() | 1);

    const requirement = Memory.alloc(GENERIC_REQUIREMENT_DESCRIPTOR_SIZE);
    requirement.writeU32(GenericRequirementKind.SameConformance);
    writeParamName(requirement.add(0x4), "A");
    const union = requirement.add(0x8);
    union.writeS32(fakeConformance.sub(union).toInt32());

    const [entry] = readGenericRequirementDescriptors(requirement, 1);
    expect(entry.kind).toBe(GenericRequirementKind.SameConformance);
    expect(entry.conformance).not.toBeNull();
    expect(entry.conformance!.protocol).not.toBeNull();
    expect(entry.conformance!.protocol!.handle.equals(hashable.handle)).toBeTruthy();
  });
});
