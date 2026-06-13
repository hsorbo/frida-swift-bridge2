import { ContextDescriptor } from "./context-descriptor.js";
import { MetadataKind, getMetadata } from "./metadata.js";
import { Field, enumerateFields } from "./field-descriptor.js";

const OFFSETOF_SUPERCLASS = 0x8;
const OFFSETOF_INSTANCE_SIZE = 0x30;
const OFFSETOF_INSTANCE_ALIGN_MASK = 0x34;
const OFFSETOF_DESCRIPTION = 0x40;

const DESC_OFFSETOF_FIELD_OFFSET_VECTOR_OFFSET = 0x28;

export class ClassMetadata {
  constructor(readonly handle: NativePointer) {}

  get superclass(): ClassMetadata | null {
    const superclass = this.handle.add(OFFSETOF_SUPERCLASS).readPointer().strip();
    return superclass.isNull() ? null : new ClassMetadata(superclass);
  }

  get instanceSize(): number {
    return this.handle.add(OFFSETOF_INSTANCE_SIZE).readU32();
  }

  get instanceAlignment(): number {
    return this.handle.add(OFFSETOF_INSTANCE_ALIGN_MASK).readU16() + 1;
  }

  get description(): ContextDescriptor {
    return new ContextDescriptor(this.handle.add(OFFSETOF_DESCRIPTION).readPointer().strip());
  }

  fieldOffset(index: number): number {
    const vectorOffset = this.description.handle
      .add(DESC_OFFSETOF_FIELD_OFFSET_VECTOR_OFFSET)
      .readU32();
    return this.handle.add((vectorOffset + index) * Process.pointerSize).readU64().toNumber();
  }
}

export function getClassMetadata(descriptor: ContextDescriptor): ClassMetadata {
  const metadata = getMetadata(descriptor);
  if (metadata.kind !== MetadataKind.Class) {
    throw new Error("descriptor is not a class");
  }
  return new ClassMetadata(metadata.handle);
}

export interface FieldWithOffset {
  field: Field;
  offset: number;
}

export function* enumerateClassFields(metadata: ClassMetadata): Generator<FieldWithOffset> {
  let index = 0;
  for (const field of enumerateFields(metadata.description)) {
    yield { field, offset: metadata.fieldOffset(index) };
    index++;
  }
}
