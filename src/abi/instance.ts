import { Metadata, MetadataKind } from "./metadata.js";
import { enumerateFields, fieldTypeIn, resolveFieldType } from "./field-descriptor.js";
import { readEnumCase, projectEnumData, projectBox } from "./enum.js";
import { readString } from "./string.js";
import { ClassMetadata, classMetadataOf, enumerateClassFields } from "./class-metadata.js";

const STRUCT_DESC_FIELD_OFFSET_VECTOR_OFFSET = 0x18;

export interface InstanceField {
  name: string;
  type: Metadata | null;
  address: NativePointer;
}

export type SwiftValue =
  | number
  | boolean
  | string
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
  "Swift.String": (p) => readString(p),
  "Swift.UnsafeRawPointer": (p) => p.readPointer(),
  "Swift.UnsafeMutableRawPointer": (p) => p.readPointer(),
  "Swift.OpaquePointer": (p) => p.readPointer(),
};

export function readValue(metadata: Metadata, address: NativePointer): SwiftValue {
  switch (metadata.kind) {
    case MetadataKind.Struct: {
      const reader = PRIMITIVE_READERS[metadata.description.fullTypeName ?? ""];
      if (reader !== undefined) {
        return reader(address);
      }
      const value: { [field: string]: SwiftValue } = {};
      for (const field of enumerateInstanceFields(metadata, address)) {
        value[field.name] = field.type === null ? null : readValue(field.type, field.address);
      }
      return value;
    }
    case MetadataKind.Enum:
    case MetadataKind.Optional:
      return readEnum(metadata, address);
    case MetadataKind.Class:
      return address.readPointer(); // reference; decode with readObject()
    default:
      return null;
  }
}

export function* enumerateClassInstanceFields(object: NativePointer): Generator<InstanceField> {
  const chain: ClassMetadata[] = [];
  let cls: ClassMetadata | null = classMetadataOf(object);
  while (cls !== null && cls.isTypeMetadata) {
    chain.push(cls);
    cls = cls.superclass;
  }

  // Base-class fields first, matching ascending in-instance offsets.
  for (const metadata of chain.reverse()) {
    const descriptor = metadata.description;
    for (const { field, offset } of enumerateClassFields(metadata)) {
      yield {
        name: field.name,
        type: resolveFieldType(field, descriptor),
        address: object.add(offset),
      };
    }
  }
}

export function readObject(object: NativePointer): { [field: string]: SwiftValue } {
  const value: { [field: string]: SwiftValue } = {};
  for (const { name, type, address } of enumerateClassInstanceFields(object)) {
    value[name] = type === null ? null : readValue(type, address);
  }
  return value;
}

function readEnum(metadata: Metadata, address: NativePointer): SwiftValue {
  const { name, payloadType, isIndirect } = readEnumCase(metadata, address);
  if (payloadType === null) {
    return name;
  }
  const scratch = Memory.alloc(metadata.typeLayout.stride);
  Memory.copy(scratch, address, metadata.typeLayout.stride);
  projectEnumData(metadata, scratch);
  const payloadAddress = isIndirect ? projectBox(scratch.readPointer()) : scratch;
  return { [name]: readValue(payloadType, payloadAddress) };
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
