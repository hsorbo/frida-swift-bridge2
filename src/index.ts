import { getSwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import { findType } from "./reflection/registry.js";
import { getMetadata, Metadata } from "./abi/metadata.js";
import { buildGenericMetadata } from "./abi/generic-instantiation.js";

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
  instantiateGenericMetadata,
} from "./abi/metadata.js";
export { buildGenericMetadata } from "./abi/generic-instantiation.js";
export {
  ProtocolConformance,
  enumerateProtocolConformances,
  enumerateProtocols,
  findProtocol,
  conformsToProtocol,
} from "./abi/protocol-conformance.js";
export {
  Field,
  enumerateFields,
  resolveFieldType,
  fieldTypeIn,
  resolveTypeByMangledName,
  symbolicMangledNameLength,
} from "./abi/field-descriptor.js";
export {
  ClassMetadata,
  getClassMetadata,
  enumerateClassFields,
} from "./abi/class-metadata.js";

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
      ? buildGenericMetadata(descriptor, typeArguments)
      : getMetadata(descriptor);
  },
};
