import { getSwiftCoreApi, SwiftCoreApi } from "./runtime/api.js";
import { demangle } from "./runtime/demangle.js";
import {
  findType,
  swiftModules,
  swiftTypes,
  swiftClasses,
  swiftStructs,
  swiftEnums,
} from "./reflection/registry.js";
import { getMetadata, Metadata } from "./abi/metadata.js";
import { buildGenericMetadata } from "./abi/generic-instantiation.js";
import { typeName } from "./runtime/type-name.js";
import { symbolicate, parseSwiftSignature, voidMetadata } from "./runtime/symbolication.js";
import { SwiftInterceptor } from "./runtime/interceptor.js";
import { SwiftType, typeOf, swiftNativeFunction } from "./runtime/swift-type.js";
import { createObject } from "./runtime/object-facade.js";
import { Protocol, ProtocolComposition, swiftProtocols } from "./runtime/protocol.js";
import { indirect, markResilientModule } from "./runtime/calling-convention.js";
import { closure } from "./runtime/closure.js";
import { findAccessibleFunction } from "./abi/accessible-function.js";

export { SwiftCoreApi, getSwiftCoreApi } from "./runtime/api.js";
export { isSwiftSymbol, demangle } from "./runtime/demangle.js";
export {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "./basic/relative-pointer.js";
export {
  getSwiftSection,
  enumerateTypeContextDescriptors,
} from "./image/sections.js";
export {
  ContextDescriptor,
  ContextDescriptorKind,
} from "./abi/context-descriptor.js";
export {
  enumerateSwiftModules,
  enumerateTypes,
  swiftModules,
  swiftTypes,
  swiftClasses,
  swiftStructs,
  swiftEnums,
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
export { Protocol, ProtocolComposition, swiftProtocols } from "./runtime/protocol.js";
export {
  AccessibleFunctionRecord,
  enumerateAccessibleFunctions,
  findAccessibleFunction,
} from "./abi/accessible-function.js";
export { AsyncFunctionPointer } from "./abi/async-function-pointer.js";
export { AsyncContext } from "./abi/async-context.js";
export { AsyncTask, Job, JobKind, JobPriority } from "./abi/async-task.js";
export {
  driveAsyncCall,
  callAsync,
  currentAsyncTask,
  SwiftAsyncThrow,
  AsyncCallOptions,
  AsyncResultShape,
  AsyncFloatArg,
  FloatClass,
} from "./runtime/async-call.js";
export {
  ProtocolRequirementKind,
  ProtocolRequirement,
  readProtocolRequirements,
  readAssociatedTypeNames,
  requirementBaseDescriptor,
  readRequirementSignature,
} from "./abi/protocol-descriptor.js";
export {
  GenericRequirementKind,
  GenericRequirementLayoutKind,
  GenericRequirementDescriptor,
  readGenericRequirementDescriptors,
} from "./abi/generic-requirement-descriptor.js";
export { WitnessTable } from "./abi/witness-table.js";
export { resolveAssociatedConformance } from "./abi/associated-type.js";
export {
  ConditionalRequirement,
  resolveConditionalRequirements,
} from "./abi/conditional-conformance.js";
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
  setEnumTag,
  projectBox,
} from "./abi/enum.js";
export {
  ExistentialRepresentation,
  OpaqueExistential,
  existentialRepresentation,
  projectOpaqueExistential,
  projectClassExistential,
  projectExistentialValue,
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
  TupleType,
  MetatypeType,
  FunctionType,
  ObjCClassWrapperType,
  ForeignClassType,
  ForeignReferenceType,
  TypeMember,
  NativeFunctionType,
  typeOf,
  swiftNativeFunction,
} from "./runtime/swift-type.js";
export {
  TupleElement,
  tupleNumElements,
  tupleLabels,
  enumerateTupleElements,
} from "./abi/tuple.js";
export { metatypeInstanceType } from "./abi/metatype.js";
export {
  KeyPathBuffer,
  KeyPathComponent,
  StoredKeyPathComponent,
  OptionalKeyPathComponent,
  ComputedKeyPathComponent,
  KeyPathComputedArguments,
  KeyPathComputedArgumentWitnesses,
  readKeyPathBuffer,
  resolveKeyPathNames,
  hashKeyPathArguments,
  keyPathArgumentsEqual,
} from "./abi/keypath.js";
export {
  FunctionType as FunctionSignature,
  FunctionParameter,
  FunctionMetadataConvention,
  ParameterOwnership,
  FunctionMetadataDifferentiabilityKind,
  FunctionIsolation,
  readFunctionType,
} from "./abi/function-type.js";
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
  ClosureRef,
  SwiftThrownError,
} from "./runtime/calling-convention.js";
export {
  SwiftClosure,
  ClosureSpec,
  ClosureBody,
  SwiftThrow,
  UnsafeRawBufferPointer,
  closure,
} from "./runtime/closure.js";
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
export { SwiftInterceptor, SwiftInvocationCallbacks, SwiftAsyncCallbacks } from "./runtime/interceptor.js";
export {
  BoundMethod,
  BoundAsyncMethod,
  CallResult,
  isSwiftObject,
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
  GenericBoundAsyncMethod,
  AccessorKind,
  PropertyInfo,
  resolveMethod,
  enumerateMethods,
  enumerateProperties,
  getProperty,
  setProperty,
  bindValueMethod,
  bindStaticMethod,
  bindValueInitializer,
  bindGenericMethod,
  bindGenericValueMethod,
  bindGenericTypeValueMethod,
  bindGenericTypeClassMethod,
  resolveWitnessMethod,
  bindWitnessMethod,
  bindWitnessMethodAt,
  WitnessMethodSignature,
  WitnessOrigin,
  classifyWitnessOrigin,
  NamedRequirement,
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
  classes: swiftClasses,
  structs: swiftStructs,
  enums: swiftEnums,
  protocols: swiftProtocols,

  metadataFor(name: string, typeArguments: Metadata[] = []): Metadata | null {
    if (name === "Swift.Void" || name === "()") {
      return voidMetadata();
    }
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
  closure,
  markResilient: markResilientModule,
  findAccessibleFunction,
  symbolicate,
  parseSignature: parseSwiftSignature,
  Interceptor: SwiftInterceptor,
  Object: createObject,
  NativeFunction: swiftNativeFunction,
  Protocol,
  ProtocolComposition,
};
