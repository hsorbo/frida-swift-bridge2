import { Metadata, MetadataKind } from "./metadata.js";
import { enumerateFields, fieldTypeIn, resolveFieldType } from "./field-descriptor.js";
import { readEnumCase, projectEnumData, projectBox, injectEnumTag } from "./enum.js";
import { readString } from "./string.js";
import {
  existentialRepresentation,
  projectOpaqueExistential,
  projectErrorExistential,
} from "./existential.js";
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

const PRIMITIVE_WRITERS: { [typeName: string]: (p: NativePointer, v: SwiftValue) => void } = {
  "Swift.Int": (p, v) => p.writeS64(v as number),
  "Swift.UInt": (p, v) => p.writeU64(v as number),
  "Swift.Int64": (p, v) => p.writeS64(v as number),
  "Swift.UInt64": (p, v) => p.writeU64(v as number),
  "Swift.Int32": (p, v) => p.writeS32(v as number),
  "Swift.UInt32": (p, v) => p.writeU32(v as number),
  "Swift.Int16": (p, v) => p.writeS16(v as number),
  "Swift.UInt16": (p, v) => p.writeU16(v as number),
  "Swift.Int8": (p, v) => p.writeS8(v as number),
  "Swift.UInt8": (p, v) => p.writeU8(v as number),
  "Swift.Bool": (p, v) => p.writeU8(v ? 1 : 0),
  "Swift.Double": (p, v) => p.writeDouble(v as number),
  "Swift.Float": (p, v) => p.writeFloat(v as number),
  "Swift.UnsafeRawPointer": (p, v) => p.writePointer(v as NativePointer),
  "Swift.UnsafeMutableRawPointer": (p, v) => p.writePointer(v as NativePointer),
  "Swift.OpaquePointer": (p, v) => p.writePointer(v as NativePointer),
};

export function writeValue(metadata: Metadata, address: NativePointer, value: SwiftValue): void {
  switch (metadata.kind) {
    case MetadataKind.Struct: {
      const name = metadata.description.fullTypeName ?? "";
      const writer = PRIMITIVE_WRITERS[name];
      if (writer !== undefined) {
        writer(address, value);
        return;
      }
      if (name in PRIMITIVE_READERS) {
        throw new Error(`writeValue: ${name} is not constructible from a JS literal`);
      }
      const fields = value as { [field: string]: SwiftValue };
      for (const field of enumerateInstanceFields(metadata, address)) {
        if (field.type === null) {
          throw new Error(`writeValue: unresolved type for field ${field.name}`);
        }
        if (!(field.name in fields)) {
          throw new Error(`writeValue: missing field ${field.name}`);
        }
        writeValue(field.type, field.address, fields[field.name]);
      }
      return;
    }
    case MetadataKind.Enum:
    case MetadataKind.Optional:
      writeEnum(metadata, address, value);
      return;
    default:
      throw new Error(`writeValue: unsupported metadata kind ${metadata.kind}`);
  }
}

function writeEnum(metadata: Metadata, address: NativePointer, value: SwiftValue): void {
  let caseName: string;
  let payload: SwiftValue | undefined;
  if (typeof value === "string") {
    caseName = value;
  } else {
    const entries = Object.entries(value as { [k: string]: SwiftValue });
    if (entries.length !== 1) {
      throw new Error("writeValue: enum value must be a case name or { case: payload }");
    }
    [caseName, payload] = entries[0];
  }

  const cases = [...enumerateFields(metadata.description)];
  const tag = cases.findIndex((c) => c.name === caseName);
  if (tag === -1) {
    throw new Error(`writeValue: unknown enum case ${caseName}`);
  }

  const field = cases[tag];
  if (field.mangledTypeName !== null) {
    if (field.isIndirectCase) {
      throw new Error(`writeValue: indirect enum case ${caseName} not supported`);
    }
    const payloadType = fieldTypeIn(metadata, field);
    if (payloadType === null) {
      throw new Error(`writeValue: unresolved payload type for case ${caseName}`);
    }
    writeValue(payloadType, address, payload as SwiftValue);
  }
  injectEnumTag(metadata, address, tag);
}

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
    case MetadataKind.Existential:
      return readExistential(metadata, address);
    default:
      return null;
  }
}

function readExistential(metadata: Metadata, address: NativePointer): SwiftValue {
  const representation = existentialRepresentation(metadata);
  if (representation === "class") {
    return address.readPointer(); // reference; decode with readObject()
  }
  const { type, value } =
    representation === "error"
      ? projectErrorExistential(address)
      : projectOpaqueExistential(address);
  return readValue(type, value);
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
