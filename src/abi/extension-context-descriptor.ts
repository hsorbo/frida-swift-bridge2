import { ContextDescriptor } from "./context-descriptor.js";
import { MangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

const OFFSETOF_EXTENDED_CONTEXT = 0x8;

export function extendedContextName(descriptor: ContextDescriptor): MangledName | null {
  const ptr = RelativeDirectPointer.resolve(descriptor.handle.add(OFFSETOF_EXTENDED_CONTEXT));
  return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
}
