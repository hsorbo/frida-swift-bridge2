import { test, expect, describe } from "@frida/injest/agent";

import { ContextDescriptor, ContextDescriptorKind } from "../src/abi/context-descriptor.js";
import { genericContextEnd } from "../src/abi/generic-instantiation.js";

const FLAG_IS_GENERIC = 0x80;
const FLAG_HAS_TYPE_PACKS = 0x1;
const FLAG_HAS_CONDITIONAL_INVERTED_PROTOCOLS = 0x2;
const FLAG_HAS_VALUES = 0x4;

function opaqueGenericDescriptor(size: number, headerFlags: number): NativePointer {
  const descriptor = Memory.alloc(size);
  descriptor.writeU32(ContextDescriptorKind.OpaqueType | FLAG_IS_GENERIC);
  descriptor.add(0x8).writeU16(0); // NumParams
  descriptor.add(0xa).writeU16(0); // NumRequirements
  descriptor.add(0xe).writeU16(headerFlags);
  return descriptor;
}

describe("generic context end", () => {
  test("skips a GenericPackShapeHeader and its descriptors when the context has type packs", () => {
    const descriptor = opaqueGenericDescriptor(0x18, FLAG_HAS_TYPE_PACKS);
    descriptor.add(0x10).writeU16(2); // NumPacks
    descriptor.add(0x12).writeU16(0); // NumShapeClasses

    const end = genericContextEnd(new ContextDescriptor(descriptor));
    expect(end).toBe(0x10 + 0x4 + 2 * 0x8); // header(0x10) + PackShapeHeader(4) + 2*PackShapeDescriptor(8)
  });

  test("skips the conditional-invertible-protocol section with an odd popcount (no padding needed)", () => {
    const descriptor = opaqueGenericDescriptor(0x24, FLAG_HAS_CONDITIONAL_INVERTED_PROTOCOLS);
    descriptor.add(0x10).writeU16(0b0001); // ConditionalInvertibleProtocolSet: 1 bit set
    descriptor.add(0x12).writeU16(3); // ConditionalInvertibleProtocolsRequirementCount[0].count (cumulative)

    const end = genericContextEnd(new ContextDescriptor(descriptor));
    // header(0x10) + set(2) + 1*count(2) [= 0x14, already 4-aligned] + 3*requirement(12)
    expect(end).toBe(0x10 + 0x2 + 0x2 + 3 * 0xc);
  });

  test("skips the conditional-invertible-protocol section with an even popcount (padding needed)", () => {
    const descriptor = opaqueGenericDescriptor(0x28, FLAG_HAS_CONDITIONAL_INVERTED_PROTOCOLS);
    descriptor.add(0x10).writeU16(0b0011); // ConditionalInvertibleProtocolSet: 2 bits set
    descriptor.add(0x12).writeU16(1); // count[0]
    descriptor.add(0x14).writeU16(3); // count[1] (cumulative total requirements)

    const end = genericContextEnd(new ContextDescriptor(descriptor));
    // header(0x10) + set(2) + 2*count(2) [= 0x16, not 4-aligned] -> pad to 0x18 + 3*requirement(12)
    expect(end).toBe(0x18 + 3 * 0xc);
  });

  test("skips a GenericValueHeader and its descriptors when the context has values", () => {
    const descriptor = opaqueGenericDescriptor(0x1c, FLAG_HAS_VALUES);
    descriptor.add(0x10).writeU32(2); // NumValues

    const end = genericContextEnd(new ContextDescriptor(descriptor));
    expect(end).toBe(0x10 + 0x4 + 2 * 0x4); // header(0x10) + ValueHeader(4) + 2*ValueDescriptor(4)
  });

  test("accumulates all three sections in order", () => {
    const descriptor = opaqueGenericDescriptor(
      0x40,
      FLAG_HAS_TYPE_PACKS | FLAG_HAS_CONDITIONAL_INVERTED_PROTOCOLS | FLAG_HAS_VALUES
    );
    descriptor.add(0x10).writeU16(1); // PackShapeHeader.NumPacks
    descriptor.add(0x12).writeU16(0); // PackShapeHeader.NumShapeClasses
    descriptor.add(0x1c).writeU16(0b0001); // ConditionalInvertibleProtocolSet: 1 bit
    descriptor.add(0x1e).writeU16(2); // count[0] (cumulative total requirements)
    descriptor.add(0x38).writeU32(1); // GenericValueHeader.NumValues

    const end = genericContextEnd(new ContextDescriptor(descriptor));
    const afterPacks = 0x10 + 0x4 + 1 * 0x8; // 0x1c
    const afterConditional = afterPacks + 0x2 + 0x2 + 2 * 0xc; // 0x38, already 4-aligned
    const afterValues = afterConditional + 0x4 + 1 * 0x4;
    expect(end).toBe(afterValues);
  });

  test("is unaffected when none of the flags are set", () => {
    const descriptor = opaqueGenericDescriptor(0x10, 0);
    const end = genericContextEnd(new ContextDescriptor(descriptor));
    expect(end).toBe(0x10);
  });
});
