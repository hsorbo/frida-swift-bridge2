import { ContextDescriptor, ContextDescriptorKind } from "./context-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

export enum ProtocolRequirementKind {
  BaseProtocol = 0,
  Method = 1,
  Init = 2,
  Getter = 3,
  Setter = 4,
  ReadCoroutine = 5,
  ModifyCoroutine = 6,
  AssociatedTypeAccessFunction = 7,
  AssociatedConformanceAccessFunction = 8,
}

export interface ProtocolRequirement {
  kind: ProtocolRequirementKind;
  isInstance: boolean;
  isAsync: boolean;
  defaultImpl: NativePointer | null;
  witnessIndex: number;
}

const OFFSETOF_NUM_REQUIREMENTS_IN_SIGNATURE = 0xc;
const OFFSETOF_NUM_REQUIREMENTS = 0x10;
const OFFSETOF_REQUIREMENT_SIGNATURE = 0x18;
const GENERIC_REQUIREMENT_DESCRIPTOR_SIZE = 0xc;
const PROTOCOL_REQUIREMENT_SIZE = 8;
const OFFSETOF_DEFAULT_IMPL = 0x4;

const WITNESS_TABLE_FIRST_REQUIREMENT_OFFSET = 1;

const KIND_MASK = 0x0f;
const IS_INSTANCE = 0x10;
const IS_ASYNC = 0x20;

export function readProtocolRequirements(descriptor: ContextDescriptor): ProtocolRequirement[] {
  if (descriptor.kind !== ContextDescriptorKind.Protocol) {
    throw new Error("readProtocolRequirements: descriptor is not a protocol");
  }

  const base = descriptor.handle;
  const numRequirementsInSignature = base.add(OFFSETOF_NUM_REQUIREMENTS_IN_SIGNATURE).readU32();
  const numRequirements = base.add(OFFSETOF_NUM_REQUIREMENTS).readU32();
  const requirementsBase = base.add(
    OFFSETOF_REQUIREMENT_SIGNATURE + numRequirementsInSignature * GENERIC_REQUIREMENT_DESCRIPTOR_SIZE
  );

  const entries: ProtocolRequirement[] = [];
  for (let i = 0; i < numRequirements; i++) {
    const rd = requirementsBase.add(i * PROTOCOL_REQUIREMENT_SIZE);
    const flags = rd.readU32();
    const defaultImpl = RelativeDirectPointer.resolve(rd.add(OFFSETOF_DEFAULT_IMPL));
    entries.push({
      kind: flags & KIND_MASK,
      isInstance: (flags & IS_INSTANCE) !== 0,
      isAsync: (flags & IS_ASYNC) !== 0,
      defaultImpl,
      witnessIndex: WITNESS_TABLE_FIRST_REQUIREMENT_OFFSET + i,
    });
  }
  return entries;
}
