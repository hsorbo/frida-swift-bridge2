import { ContextDescriptor } from "./context-descriptor.js";
import { genericContextEnd } from "./generic-instantiation.js";
import { MangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

// AnonymousContextDescriptorFlags::HasMangledName, kind-specific flags bit 0 (bit 16 overall).
const FLAG_HAS_MANGLED_NAME = 0x10000;

const OFFSETOF_NO_GENERIC_MANGLED_NAME = 0x8;

export function hasMangledName(descriptor: ContextDescriptor): boolean {
  return (descriptor.flags & FLAG_HAS_MANGLED_NAME) !== 0;
}

export function anonymousMangledName(descriptor: ContextDescriptor): MangledName | null {
  if (!hasMangledName(descriptor)) {
    return null;
  }
  const offset = descriptor.isGeneric
    ? genericContextEnd(descriptor)
    : OFFSETOF_NO_GENERIC_MANGLED_NAME;
  const ptr = RelativeDirectPointer.resolve(descriptor.handle.add(offset));
  return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
}
