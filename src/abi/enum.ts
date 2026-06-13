import { Metadata } from "./metadata.js";
import { enumerateFields, fieldTypeIn } from "./field-descriptor.js";

const VWT_OFFSETOF_GET_ENUM_TAG = 0x58;
const VWT_OFFSETOF_DESTRUCTIVE_PROJECT_ENUM_DATA = 0x60;
const VWT_OFFSETOF_DESTRUCTIVE_INJECT_ENUM_TAG = 0x68;

export interface EnumCase {
  name: string;
  tag: number;
  payloadType: Metadata | null;
}

export function enumTag(metadata: Metadata, address: NativePointer): number {
  const fn = new NativeFunction(
    metadata.valueWitnessTable.add(VWT_OFFSETOF_GET_ENUM_TAG).readPointer(),
    "uint",
    ["pointer", "pointer"]
  );
  return fn(address, metadata.handle) as number;
}

export function readEnumCase(metadata: Metadata, address: NativePointer): EnumCase {
  const tag = enumTag(metadata, address);
  const cases = [...enumerateFields(metadata.description)];
  const field = cases[tag];
  if (field === undefined) {
    throw new Error(`enum tag ${tag} out of range (${cases.length} cases)`);
  }
  return {
    name: field.name,
    tag,
    payloadType: field.mangledTypeName !== null ? fieldTypeIn(metadata, field) : null,
  };
}

export function projectEnumData(metadata: Metadata, address: NativePointer): void {
  const fn = new NativeFunction(
    metadata.valueWitnessTable.add(VWT_OFFSETOF_DESTRUCTIVE_PROJECT_ENUM_DATA).readPointer(),
    "void",
    ["pointer", "pointer"]
  );
  fn(address, metadata.handle);
}

export function injectEnumTag(metadata: Metadata, address: NativePointer, tag: number): void {
  const fn = new NativeFunction(
    metadata.valueWitnessTable.add(VWT_OFFSETOF_DESTRUCTIVE_INJECT_ENUM_TAG).readPointer(),
    "void",
    ["pointer", "uint", "pointer"]
  );
  fn(address, tag, metadata.handle);
}
