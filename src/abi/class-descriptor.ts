import { ContextDescriptor } from "./context-descriptor.js";
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
  index: number;
  kind: MethodDescriptorKind;
  isInstance: boolean;
  isDynamic: boolean;
  impl: NativePointer;
}

// The override table follows the method descriptors, so it never shifts these; only a generic
// header / resilient superclass / metadata-init would, hence the guard below.
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
  const size = base.add(OFFSETOF_VTABLE_SIZE).readU32();
  const entries: VTableEntry[] = [];
  for (let i = 0; i < size; i++) {
    const md = base.add(OFFSETOF_METHOD_DESCRIPTORS + i * METHOD_DESCRIPTOR_SIZE);
    const impl = RelativeDirectPointer.resolve(md.add(OFFSETOF_IMPL));
    if (impl === null) {
      continue;
    }
    const flags = md.readU32();
    entries.push({
      index: i,
      kind: flags & KIND_MASK,
      isInstance: (flags & IS_INSTANCE) !== 0,
      isDynamic: (flags & IS_DYNAMIC) !== 0,
      impl,
    });
  }
  return entries;
}
