import { Metadata, MetadataKind } from "./metadata.js";
import { enumerateFields, fieldTypeIn } from "./field-descriptor.js";

const STRUCT_DESC_FIELD_OFFSET_VECTOR_OFFSET = 0x18;

export interface InstanceField {
  name: string;
  type: Metadata | null;
  address: NativePointer;
}

export function* enumerateInstanceFields(
  metadata: Metadata,
  address: NativePointer
): Generator<InstanceField> {
  if (metadata.kind !== MetadataKind.Struct) {
    throw new Error("enumerateInstanceFields currently supports struct values only");
  }

  const descriptor = metadata.description;
  const vectorOffset = descriptor.handle
    .add(STRUCT_DESC_FIELD_OFFSET_VECTOR_OFFSET)
    .readU32();
  if (vectorOffset === 0) {
    return;
  }
  const offsets = metadata.handle.add(vectorOffset * Process.pointerSize);

  let index = 0;
  for (const field of enumerateFields(descriptor)) {
    const offset = offsets.add(index * 4).readU32();
    yield {
      name: field.name,
      type: fieldTypeIn(metadata, field),
      address: address.add(offset),
    };
    index++;
  }
}
