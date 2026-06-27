import { ContextDescriptor } from "./context-descriptor.js";
import { ClassMetadata } from "./class-metadata.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

export enum MethodDescriptorKind {
  Method = 0,
  Init = 1,
  Getter = 2,
  Setter = 3,
  ModifyCoroutine = 4,
  ReadCoroutine = 5,
}

export interface VTableEntry {
  kind: MethodDescriptorKind;
  isInstance: boolean;
  isDynamic: boolean;
  declaredImpl: NativePointer;
  metadataOffset: number; // VTableOffset + slot
}

// The override table follows the method descriptors, so it never shifts these; only a generic
// header / resilient superclass / metadata-init would, hence the guard below.
const OFFSETOF_VTABLE_OFFSET = 0x2c;
const OFFSETOF_VTABLE_SIZE = 0x30;
const OFFSETOF_METHOD_DESCRIPTORS = 0x34;
const METHOD_DESCRIPTOR_SIZE = 8;
const OFFSETOF_IMPL = 0x4;

const KIND_FLAGS_SHIFT = 16;
const CLASS_HAS_VTABLE = 1 << 15;
const CLASS_HAS_RESILIENT_SUPERCLASS = 1 << 13;
const METADATA_INITIALIZATION_MASK = 0x3;

const KIND_MASK = 0x0f;
const IS_INSTANCE = 0x10;
const IS_DYNAMIC = 0x20;

export function readVTable(descriptor: ContextDescriptor): VTableEntry[] {
  const kindFlags = descriptor.flags >>> KIND_FLAGS_SHIFT;
  if ((kindFlags & CLASS_HAS_VTABLE) === 0) {
    return [];
  }
  const name = descriptor.fullTypeName;
  if (descriptor.isGeneric) {
    throw new Error(`readVTable: ${name} is generic; vtable offset is not fixed`);
  }
  if ((kindFlags & CLASS_HAS_RESILIENT_SUPERCLASS) !== 0) {
    throw new Error(`readVTable: ${name} has a resilient superclass; vtable offset is not fixed`);
  }
  if ((kindFlags & METADATA_INITIALIZATION_MASK) !== 0) {
    throw new Error(`readVTable: ${name} needs metadata initialization; vtable offset is not fixed`);
  }

  const base = descriptor.handle;
  const vtableOffset = base.add(OFFSETOF_VTABLE_OFFSET).readU32();
  const size = base.add(OFFSETOF_VTABLE_SIZE).readU32();
  const entries: VTableEntry[] = [];
  for (let i = 0; i < size; i++) {
    const md = base.add(OFFSETOF_METHOD_DESCRIPTORS + i * METHOD_DESCRIPTOR_SIZE);
    const declaredImpl = RelativeDirectPointer.resolve(md.add(OFFSETOF_IMPL));
    if (declaredImpl === null) {
      continue;
    }
    const flags = md.readU32();
    entries.push({
      kind: flags & KIND_MASK,
      isInstance: (flags & IS_INSTANCE) !== 0,
      isDynamic: (flags & IS_DYNAMIC) !== 0,
      declaredImpl,
      metadataOffset: vtableOffset + i,
    });
  }
  return entries;
}

// A class's slots keep a fixed metadata offset in every subclass, so a base slot addresses the
// override; overrides don't recur here (they live in the override table readVTable skips).
export function readVTableChain(metadata: ClassMetadata): VTableEntry[] {
  const entries: VTableEntry[] = [];
  let cls: ClassMetadata | null = metadata;
  while (cls !== null && cls.isTypeMetadata) {
    entries.push(...readVTable(cls.description));
    cls = cls.superclass;
  }
  return entries;
}
