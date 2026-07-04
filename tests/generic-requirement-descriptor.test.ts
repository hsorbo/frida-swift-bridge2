import { test, expect, describe } from "@frida/injest/agent";

import {
  GenericRequirementKind,
  GenericRequirementLayoutKind,
  readGenericRequirementDescriptors,
  GENERIC_REQUIREMENT_DESCRIPTOR_SIZE,
} from "../src/abi/generic-requirement-descriptor.js";

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
});
