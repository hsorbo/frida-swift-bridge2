import { ContextDescriptor } from "./context-descriptor.js";
import { MangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

export const GENERIC_REQUIREMENT_DESCRIPTOR_SIZE = 0xc;

const OFFSETOF_PARAM = 0x4;
const OFFSETOF_UNION = 0x8;

const KIND_MASK = 0x1f;
const HAS_KEY_ARGUMENT = 0x80;

// unlike RelativeIndirectablePointer, this pointer format reserves an extra bit for isObjC
const OBJC_PROTOCOL_BIT = 0x2;

export enum GenericRequirementKind {
  Protocol = 0,
  SameType = 1,
  BaseClass = 2,
  SameConformance = 3,
  SameShape = 4,
  InvertedProtocols = 5,
  Layout = 0x1f,
}

export interface GenericRequirementDescriptor {
  kind: GenericRequirementKind;
  hasKeyArgument: boolean;
  param: MangledName;
  protocol: ContextDescriptor | null;
  isObjCProtocol: boolean;
  sameTypeName: MangledName | null;
  address: NativePointer;
}

function readMangledName(at: NativePointer): MangledName | null {
  const ptr = RelativeDirectPointer.resolve(at);
  return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
}

function resolveProtocolConstraint(at: NativePointer): { protocol: ContextDescriptor | null; isObjC: boolean } {
  const raw = at.readS32();
  const isObjC = (raw & OBJC_PROTOCOL_BIT) !== 0;
  if (isObjC) {
    return { protocol: null, isObjC: true };
  }
  const offset = raw & ~OBJC_PROTOCOL_BIT;
  if (offset === 0) {
    return { protocol: null, isObjC: false };
  }
  const address = at.add(offset & ~1);
  const resolved = (offset & 1) !== 0 ? address.readPointer().strip() : address;
  return { protocol: new ContextDescriptor(resolved), isObjC: false };
}

export function readGenericRequirementDescriptors(
  base: NativePointer,
  count: number
): GenericRequirementDescriptor[] {
  const entries: GenericRequirementDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    const address = base.add(i * GENERIC_REQUIREMENT_DESCRIPTOR_SIZE);
    const flags = address.readU32();
    const kind: GenericRequirementKind = flags & KIND_MASK;
    const param = readMangledName(address.add(OFFSETOF_PARAM))!;

    let protocol: ContextDescriptor | null = null;
    let isObjCProtocol = false;
    let sameTypeName: MangledName | null = null;
    if (kind === GenericRequirementKind.Protocol) {
      ({ protocol, isObjC: isObjCProtocol } = resolveProtocolConstraint(address.add(OFFSETOF_UNION)));
    } else if (
      kind === GenericRequirementKind.SameType ||
      kind === GenericRequirementKind.BaseClass ||
      kind === GenericRequirementKind.SameShape
    ) {
      sameTypeName = readMangledName(address.add(OFFSETOF_UNION));
    }

    entries.push({
      kind,
      hasKeyArgument: (flags & HAS_KEY_ARGUMENT) !== 0,
      param,
      protocol,
      isObjCProtocol,
      sameTypeName,
      address,
    });
  }
  return entries;
}
