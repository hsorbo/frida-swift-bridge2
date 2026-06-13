import { getSwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import { findType } from "./reflection/registry.js";
import { getMetadata, getGenericMetadata, Metadata } from "./abi/metadata.js";

export { isSwiftSymbol, demangle } from "./runtime/demangle.js";
export {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "./basic/relative-pointer.js";
export {
  getSwiftSection,
  enumerateTypeContextDescriptors,
} from "./macho/sections.js";
export {
  ContextDescriptor,
  ContextDescriptorKind,
} from "./abi/context-descriptor.js";
export {
  enumerateSwiftModules,
  enumerateTypes,
  findType,
} from "./reflection/registry.js";
export {
  MetadataKind,
  Metadata,
  getMetadata,
  getGenericMetadata,
} from "./abi/metadata.js";
export {
  Field,
  enumerateFields,
  resolveFieldType,
  resolveTypeByMangledName,
  symbolicMangledNameLength,
} from "./abi/field-descriptor.js";

export const Swift = {
  get available(): boolean {
    try {
      getSwiftCoreApi();
      return true;
    } catch {
      return false;
    }
  },

  demangle,
  findType,

  metadataFor(name: string, typeArguments: Metadata[] = []): Metadata | null {
    const descriptor = findType(name);
    if (descriptor === null) {
      return null;
    }
    return typeArguments.length > 0
      ? getGenericMetadata(descriptor, typeArguments)
      : getMetadata(descriptor);
  },
};
