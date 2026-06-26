import { getSwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import { findType } from "./reflection/registry.js";
import { getMetadata, Metadata } from "./abi/metadata.js";
import { buildGenericMetadata } from "./abi/generic-instantiation.js";
import { typeName } from "./runtime/type-name.js";
import { symbolicate, parseSwiftSignature } from "./runtime/symbolication.js";
import { SwiftInterceptor } from "./runtime/interceptor.js";
import { SwiftType, typeOf } from "./runtime/swift-type.js";

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
  classMetadataOf,
  enumerateClassFields,
} from "./abi/class-metadata.js";
export {
  InstanceField,
  SwiftValue,
  enumerateInstanceFields,
  enumerateClassInstanceFields,
  readValue,
  writeValue,
  readObject,
} from "./abi/instance.js";
export {
  EnumCase,
  enumTag,
  readEnumCase,
  projectEnumData,
  injectEnumTag,
  projectBox,
} from "./abi/enum.js";
export {
  ExistentialRepresentation,
  OpaqueExistential,
  existentialRepresentation,
  projectOpaqueExistential,
  projectErrorExistential,
} from "./abi/existential.js";
export { Value } from "./abi/value.js";
export { HeapObject } from "./abi/heap-object.js";
export {
  SwiftType,
  StructType,
  EnumType,
  ClassType,
  TypeMember,
  typeOf,
} from "./runtime/swift-type.js";
export {
  ValueWitnessTable,
  NUM_WORDS_VALUE_BUFFER,
  allocateValueBuffer,
} from "./abi/value-witness.js";
export {
  shouldPassIndirectly,
  MAX_LOADABLE_SIZE,
  makeSwiftNativeFunction,
  SwiftNativeFunction,
  SwiftNativeFunctionOptions,
  SwiftArgType,
  GenericRef,
  SwiftThrownError,
} from "./runtime/calling-convention.js";
export { readString } from "./abi/string.js";
export { typeName } from "./runtime/type-name.js";
export {
  SwiftSymbol,
  SwiftFunctionSignature,
  SwiftAccessorSignature,
  ParsedSwiftSignature,
  ResolvedFunctionSignature,
  symbolicate,
  parseSwiftSignature,
  resolveFunctionSignature,
  resolveType,
} from "./runtime/symbolication.js";
export { SwiftInterceptor, SwiftInvocationCallbacks } from "./runtime/interceptor.js";

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

  typeName(metadata: Metadata): string {
    return typeName(metadata);
  },

  typeOf(metadata: Metadata): SwiftType {
    return typeOf(metadata);
  },

  symbolicate,
  parseSignature: parseSwiftSignature,
  Interceptor: SwiftInterceptor,
};
