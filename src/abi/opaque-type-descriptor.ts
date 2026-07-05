import { ContextDescriptor } from "./context-descriptor.js";
import { genericContextEnd, genericRequirements } from "./generic-instantiation.js";
import { GenericRequirementDescriptor } from "./generic-requirement-descriptor.js";
import { MangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

const OFFSETOF_NO_GENERIC_UNDERLYING_TYPES = 0x8;
const UNDERLYING_TYPE_ARGUMENT_SIZE = 0x4;

// count lives in the kind-specific flags bits; there is no dedicated field.
export function numUnderlyingTypeArguments(descriptor: ContextDescriptor): number {
  return descriptor.flags >>> 16;
}

export function underlyingTypeArgumentMangledName(
  descriptor: ContextDescriptor,
  index: number
): MangledName {
  const count = numUnderlyingTypeArguments(descriptor);
  if (index < 0 || index >= count) {
    throw new Error(`underlying type argument index ${index} out of range (${count})`);
  }
  const base = descriptor.isGeneric
    ? genericContextEnd(descriptor)
    : OFFSETOF_NO_GENERIC_UNDERLYING_TYPES;
  const ptr = RelativeDirectPointer.resolve(
    descriptor.handle.add(base + index * UNDERLYING_TYPE_ARGUMENT_SIZE)
  );
  if (ptr === null) {
    throw new Error("underlying type argument mangled name is null");
  }
  return { address: ptr, length: symbolicMangledNameLength(ptr) };
}

export function opaqueTypeRequirements(descriptor: ContextDescriptor): GenericRequirementDescriptor[] {
  return descriptor.isGeneric ? genericRequirements(descriptor) : [];
}
