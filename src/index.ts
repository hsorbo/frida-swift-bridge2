import { getSwiftCoreApi, SwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import { findType, swiftModules, swiftTypes } from "./reflection/registry.js";
import { getMetadata, Metadata } from "./abi/metadata.js";
import { buildGenericMetadata } from "./abi/generic-instantiation.js";
import { typeName } from "./runtime/type-name.js";
import { symbolicate, parseSwiftSignature } from "./runtime/symbolication.js";
import { SwiftInterceptor } from "./runtime/interceptor.js";
import { SwiftType, typeOf, swiftNativeFunction } from "./runtime/swift-type.js";
import { createObject } from "./runtime/object-facade.js";
import { Protocol, ProtocolComposition } from "./runtime/protocol.js";
import { indirect, markResilientModule } from "./runtime/calling-convention.js";

export { SwiftCoreApi, getSwiftCoreApi } from "./runtime/api.js";
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
  swiftModules,
  swiftTypes,
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
export { Protocol, ProtocolComposition } from "./runtime/protocol.js";
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
  dynamicTypeOf,
  enumerateClassFields,
} from "./abi/class-metadata.js";
export {
  MethodDescriptorKind,
  VTableEntry,
  readVTable,
  readVTableChain,
} from "./abi/class-descriptor.js";
export {
  InstanceField,
  SwiftValue,
  enumerateInstanceFields,
  enumerateClassInstanceFields,
  readValue,
  writeValue,
  readObject,
  embedsManagedReference,
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
export { ValueInstance } from "./abi/value.js";
export { ClassInstance } from "./abi/heap-object.js";
export {
  SwiftType,
  ValueType,
  StructType,
  EnumType,
  ClassType,
  TypeMember,
  NativeFunctionType,
  typeOf,
  swiftNativeFunction,
} from "./runtime/swift-type.js";
export {
  ValueWitnessTable,
  NUM_WORDS_VALUE_BUFFER,
  allocateValueBuffer,
} from "./abi/value-witness.js";
export {
  shouldPassIndirectly,
  isResilientValueType,
  markResilientModule,
  indirect,
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
  GenericRequirement,
  SwiftAccessorSignature,
  ParsedSwiftSignature,
  ResolvedFunctionSignature,
  symbolicate,
  parseSwiftSignature,
  resolveFunctionSignature,
  resolveType,
} from "./runtime/symbolication.js";
export { SwiftInterceptor, SwiftInvocationCallbacks } from "./runtime/interceptor.js";
export {
  BoundMethod,
  CallResult,
  Instance,
  CallArg,
  MethodInfo,
  MethodKind,
  ResolvedMethod,
  MethodResolveOptions,
  ValueMethodResolveOptions,
  BoundValueMethod,
  BoundStaticMethod,
  BoundValueInitializer,
  GenericBoundMethod,
  AccessorKind,
  PropertyInfo,
  resolveMethod,
  enumerateMethods,
  enumerateProperties,
  bindValueMethod,
  bindStaticMethod,
  bindValueInitializer,
  bindGenericMethod,
  getProperty,
  setProperty,
} from "./runtime/method.js";
export { SwiftObject, createObject } from "./runtime/object-facade.js";

export const Swift = {
  get available(): boolean {
    try {
      getSwiftCoreApi();
      return true;
    } catch {
      return false;
    }
  },

  get api(): SwiftCoreApi {
    return getSwiftCoreApi();
  },

  demangle,
  findType,
  modules: swiftModules,
  types: swiftTypes,

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

  indirect,
  markResilient: markResilientModule,
  symbolicate,
  parseSignature: parseSwiftSignature,
  Interceptor: SwiftInterceptor,
  Object: createObject,
  NativeFunction: swiftNativeFunction,
  Protocol,
  ProtocolComposition,
};
