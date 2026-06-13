import { ContextDescriptor } from "./context-descriptor.js";
import { MetadataKind, getMetadata } from "./metadata.js";
import { Field, enumerateFields } from "./field-descriptor.js";

const OFFSETOF_SUPERCLASS = 0x8;
const OFFSETOF_DATA = 0x20;
const OFFSETOF_INSTANCE_SIZE = 0x30;
const OFFSETOF_INSTANCE_ALIGN_MASK = 0x34;
const OFFSETOF_DESCRIPTION = 0x40;

const SWIFT_CLASS_IS_SWIFT_MASK = 2; // Darwin (ObjC interop)
const CLASS_HAS_RESILIENT_SUPERCLASS = 1 << 13; // bit 13 of kind-specific flags

const DESC_OFFSETOF_FIELD_OFFSET_VECTOR_OFFSET = 0x28;

export class ClassMetadata {
  constructor(readonly handle: NativePointer) {}

  get isTypeMetadata(): boolean {
    return (this.handle.add(OFFSETOF_DATA).readU8() & SWIFT_CLASS_IS_SWIFT_MASK) !== 0;
  }

  get superclass(): ClassMetadata | null {
    const superclass = this.handle.add(OFFSETOF_SUPERCLASS).readPointer().strip();
    return superclass.isNull() ? null : new ClassMetadata(superclass);
  }

  get instanceSize(): number {
    this.requireTypeMetadata();
    return this.handle.add(OFFSETOF_INSTANCE_SIZE).readU32();
  }

  get instanceAlignment(): number {
    this.requireTypeMetadata();
    return this.handle.add(OFFSETOF_INSTANCE_ALIGN_MASK).readU16() + 1;
  }

  get description(): ContextDescriptor {
    this.requireTypeMetadata();
    return new ContextDescriptor(this.handle.add(OFFSETOF_DESCRIPTION).readPointer().strip());
  }

  fieldOffset(index: number): number {
    const descriptor = this.description;
    if ((descriptor.flags >>> 16) & CLASS_HAS_RESILIENT_SUPERCLASS) {
      throw new Error("field offsets for resilient-superclass classes are not supported");
    }
    const vectorOffset = descriptor.handle
      .add(DESC_OFFSETOF_FIELD_OFFSET_VECTOR_OFFSET)
      .readU32();
    return this.handle.add((vectorOffset + index) * Process.pointerSize).readU64().toNumber();
  }

  private requireTypeMetadata(): void {
    if (!this.isTypeMetadata) {
      throw new Error("not Swift class metadata (Objective-C or foreign class)");
    }
  }
}

export function getClassMetadata(descriptor: ContextDescriptor): ClassMetadata {
  const metadata = getMetadata(descriptor);
  if (metadata.kind !== MetadataKind.Class) {
    throw new Error("descriptor is not a class");
  }
  return new ClassMetadata(metadata.handle);
}

export function classMetadataOf(object: NativePointer): ClassMetadata {
  return new ClassMetadata(object.readPointer().strip());
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
