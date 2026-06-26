import { Metadata } from "./metadata.js";

const FLAGS_OFFSET = Process.pointerSize;
const TYPE_OFFSET = 3 * Process.pointerSize;

const SPECIAL_PROTOCOL_MASK = 0x3f000000;
const SPECIAL_PROTOCOL_ERROR = 0x01000000;
const NOT_CLASS_CONSTRAINED = 0x80000000;

export type ExistentialRepresentation = "opaque" | "class" | "error";

export function existentialRepresentation(metadata: Metadata): ExistentialRepresentation {
  const flags = metadata.handle.add(FLAGS_OFFSET).readU32();
  if ((flags & SPECIAL_PROTOCOL_MASK) === SPECIAL_PROTOCOL_ERROR) {
    return "error";
  }
  return (flags & NOT_CLASS_CONSTRAINED) !== 0 ? "opaque" : "class";
}

export interface OpaqueExistential {
  type: Metadata;
  value: NativePointer;
}

export function projectOpaqueExistential(container: NativePointer): OpaqueExistential {
  const type = new Metadata(container.add(TYPE_OFFSET).readPointer());
  return { type, value: type.valueWitnesses.projectBuffer(container) };
}
