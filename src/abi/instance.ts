import { Metadata, MetadataKind } from "./metadata.js";
import { enumerateFields, fieldTypeIn } from "./field-descriptor.js";

const STRUCT_DESC_FIELD_OFFSET_VECTOR_OFFSET = 0x18;

export interface InstanceField {
  name: string;
  type: Metadata | null;
  address: NativePointer;
}

export type SwiftValue =
  | number
  | boolean
  | NativePointer
  | { [field: string]: SwiftValue }
  | null;

const PRIMITIVE_READERS: { [typeName: string]: (p: NativePointer) => SwiftValue } = {
  "Swift.Int": (p) => p.readS64().toNumber(),
  "Swift.UInt": (p) => p.readU64().toNumber(),
  "Swift.Int64": (p) => p.readS64().toNumber(),
  "Swift.UInt64": (p) => p.readU64().toNumber(),
  "Swift.Int32": (p) => p.readS32(),
  "Swift.UInt32": (p) => p.readU32(),
  "Swift.Int16": (p) => p.readS16(),
  "Swift.UInt16": (p) => p.readU16(),
  "Swift.Int8": (p) => p.readS8(),
  "Swift.UInt8": (p) => p.readU8(),
  "Swift.Bool": (p) => p.readU8() !== 0,
  "Swift.Double": (p) => p.readDouble(),
  "Swift.Float": (p) => p.readFloat(),
  "Swift.UnsafeRawPointer": (p) => p.readPointer(),
  "Swift.UnsafeMutableRawPointer": (p) => p.readPointer(),
  "Swift.OpaquePointer": (p) => p.readPointer(),
};

export function readValue(metadata: Metadata, address: NativePointer): SwiftValue {
  const reader = PRIMITIVE_READERS[metadata.description.fullTypeName ?? ""];
  if (reader !== undefined) {
    return reader(address);
  }
  if (metadata.kind !== MetadataKind.Struct) {
    return null;
  }
  const value: { [field: string]: SwiftValue } = {};
  for (const field of enumerateInstanceFields(metadata, address)) {
    value[field.name] = field.type === null ? null : readValue(field.type, field.address);
  }
  return value;
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
