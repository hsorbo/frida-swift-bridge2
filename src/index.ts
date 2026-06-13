import { getSwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import { findType } from "./reflection/registry.js";
import { getMetadata, Metadata } from "./abi/metadata.js";

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
} from "./abi/metadata.js";

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

  metadataFor(name: string): Metadata | null {
    const descriptor = findType(name);
    return descriptor === null ? null : getMetadata(descriptor);
  },
};
