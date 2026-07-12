import { Metadata, MetadataKind } from "../abi/metadata.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { isActor, isDefaultActor, readVTableChain, VTableEntry } from "../abi/class-descriptor.js";
import { ValueInstance } from "../abi/value.js";
import { ClassInstance } from "../abi/heap-object.js";
import { createObject, SwiftObject } from "./object-facade.js";
import { writeValue, SwiftValue } from "../abi/instance.js";
import { enumerateFields, fieldTypeIn } from "../abi/field-descriptor.js";
import {
  makeSwiftNativeFunction,
  SwiftArgType,
  SwiftNativeFunction,
  SwiftNativeFunctionOptions,
} from "./calling-convention.js";
import { parseSwiftSignature, resolveType } from "./symbolication.js";
import {
  BoundMethod,
  BoundStaticMethod,
  BoundAsyncMethod,
  BoundValueInitializer,
  CallArg,
  CallResult,
  MethodResolveOptions,
  PropertyInfo,
  bindStaticMethod,
  bindValueInitializer,
  enumerateMethods,
  enumerateProperties,
  resolveMethod,
} from "./method.js";
import { enumerateTupleElements, tupleLabels, TupleElement } from "../abi/tuple.js";
import { metatypeInstanceType } from "../abi/metatype.js";
import { readFunctionType, FunctionType as FunctionSignature } from "../abi/function-type.js";
import { demangle } from "./demangle.js";
import { typeName } from "./type-name.js";
import { getSwiftCoreApi } from "./api.js";
import { Protocol, ProtocolComposition, protocolsForType } from "./protocol.js";

export interface TypeMember {
  name: string;
  type: Metadata | null;
  isVar: boolean;
}

export interface MethodQuery {
  static?: boolean;
  inherited?: boolean;
}

function typeKindName(metadata: Metadata): string {
  switch (metadata.kind) {
    case MetadataKind.Class:
      return "class";
    case MetadataKind.Struct:
      return "struct";
    case MetadataKind.Enum:
    case MetadataKind.Optional:
      return "enum";
    case MetadataKind.Tuple:
      return "tuple";
    case MetadataKind.Metatype:
      return "metatype";
    case MetadataKind.Function:
      return "function";
    case MetadataKind.ObjCClassWrapper:
      return "objc-class";
    default:
      return "type";
  }
}

export class SwiftType {
  constructor(readonly metadata: Metadata) {}

  get name(): string {
    return typeName(this.metadata);
  }

  get superClass(): SwiftType | null {
    return null;
  }

  get moduleName(): string | null {
    return Process.findModuleByAddress(this.descriptorHandle)?.path ?? null;
  }

  toJSON(): { kind: string; name: string; module: string | null } {
    return { kind: typeKindName(this.metadata), name: this.name, module: this.jsonModule() };
  }

  private jsonModule(): string | null {
    const kind = this.metadata.kind;
    if (
      kind !== MetadataKind.Class &&
      kind !== MetadataKind.Struct &&
      kind !== MetadataKind.Enum &&
      kind !== MetadataKind.Optional
    ) {
      return null;
    }
    return Process.findModuleByAddress(this.descriptorHandle)?.name ?? null;
  }

  methods(options: MethodQuery = {}): string[] {
    const { static: wantStatic = false, inherited = true } = options;
    return enumerateMethods(this.name, !inherited)
      .filter((m) => m.kind === "method" && m.isStatic === wantStatic)
      .map((m) => m.selector);
  }

  protocols(): { [name: string]: Protocol } {
    return protocolsForType(this.descriptorHandle);
  }

  get properties(): PropertyInfo[] {
    return enumerateProperties(this.name);
  }

  protected get descriptorHandle(): NativePointer {
    return this.metadata.description.handle;
  }
}

export class ValueType extends SwiftType {
  method(name: string, options: MethodResolveOptions = {}): BoundStaticMethod | BoundAsyncMethod {
    return bindStaticMethod(this.metadata, name, options);
  }

  call(name: string, ...args: SwiftValue[]): CallResult | Promise<CallResult> {
    return this.method(name).call(...args);
  }

  initializer(options: MethodResolveOptions = {}): BoundValueInitializer {
    return bindValueInitializer(this.metadata, options);
  }

  init(...args: CallArg[]): SwiftObject {
    return this.initializer().call(...args);
  }
}

export class StructType extends ValueType {
  new(value: SwiftValue): SwiftObject {
    return createObject(ValueInstance.fromJS(this.metadata, value));
  }

  get fields(): TypeMember[] {
    return [...enumerateFields(this.metadata.description)].map((f) => ({
      name: f.name,
      type: fieldTypeIn(this.metadata, f),
      isVar: f.isVar,
    }));
  }
}

export class EnumType extends ValueType {
  case(name: string, payload?: SwiftValue): SwiftObject {
    return createObject(ValueInstance.fromJS(this.metadata, payload === undefined ? name : { [name]: payload }));
  }

  get cases(): TypeMember[] {
    return [...enumerateFields(this.metadata.description)].map((f) => ({
      name: f.name,
      type: f.mangledTypeName !== null ? fieldTypeIn(this.metadata, f) : null,
      isVar: f.isVar,
    }));
  }
}

export class ObjCClassWrapperType extends SwiftType {
  get objcClass(): NativePointer {
    return this.metadata.handle.add(Process.pointerSize).readPointer().strip();
  }
}

export class ClassType extends SwiftType {
  private initializer: { address: NativePointer; argTypes: Metadata[] } | null = null;
  private vtableEntries: VTableEntry[] | null = null;

  get vtable(): VTableEntry[] {
    if (this.vtableEntries === null) {
      this.vtableEntries = readVTableChain(new ClassMetadata(this.metadata.handle));
    }
    return this.vtableEntries;
  }

  protected get descriptorHandle(): NativePointer {
    return new ClassMetadata(this.metadata.handle).description.handle;
  }

  get superClass(): SwiftType | null {
    const superclass = new ClassMetadata(this.metadata.handle).superclass;
    return superclass !== null && superclass.isTypeMetadata
      ? typeOf(new Metadata(superclass.handle))
      : null;
  }

  get isActor(): boolean {
    return isActor(new ClassMetadata(this.metadata.handle).description);
  }

  get isDefaultActor(): boolean {
    return isDefaultActor(new ClassMetadata(this.metadata.handle).description);
  }

  init(...args: SwiftValue[]): SwiftObject {
    const { address, argTypes } = this.resolveInitializer();
    if (args.length !== argTypes.length) {
      throw new Error(`init expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    const call = makeSwiftNativeFunction(address, this.metadata, argTypes, { hasSelf: true });
    // Initializer params are +1/owned: the callee consumes each temp, so they are not destroyed here.
    const argPtrs = args.map((value, i) => {
      const buffer = Memory.alloc(argTypes[i].typeLayout.stride);
      writeValue(argTypes[i], buffer, value);
      return buffer;
    });
    return createObject(ClassInstance.adopt(call(this.metadata.handle, ...argPtrs)!.readPointer()));
  }

  // +1 raw storage; initialize fields before the wrapper is released (deinit runs over them).
  alloc(): SwiftObject {
    const cls = new ClassMetadata(this.metadata.handle);
    const object = getSwiftCoreApi().swift_allocObject(
      cls.handle,
      cls.instanceSize,
      cls.instanceAlignment - 1
    );
    return createObject(ClassInstance.adopt(object));
  }

  method(name: string, options: MethodResolveOptions = {}): BoundMethod | BoundAsyncMethod {
    const resolved = resolveMethod(this.fullName, name, { ...options, static: true });
    return resolved.async === true
      ? new BoundAsyncMethod(resolved, this.metadata.handle)
      : new BoundMethod(resolved, this.metadata.handle);
  }

  call(name: string, ...args: SwiftValue[]): CallResult | Promise<CallResult> {
    return this.method(name).call(...args);
  }

  private get fullName(): string {
    const name = new ClassMetadata(this.metadata.handle).description.fullTypeName;
    if (name === null) {
      throw new Error("class has no type name");
    }
    return name;
  }

  private resolveInitializer(): { address: NativePointer; argTypes: Metadata[] } {
    if (this.initializer !== null) {
      return this.initializer;
    }
    const descriptor = new ClassMetadata(this.metadata.handle).description;
    const fullName = descriptor.fullTypeName;
    if (fullName === null) {
      throw new Error("class has no type name");
    }
    const module = Process.findModuleByAddress(descriptor.handle);
    if (module === null) {
      throw new Error(`no module owns ${fullName}`);
    }
    const prefix = `${fullName}.__allocating_init`;
    for (const e of module.enumerateExports()) {
      const demangled = demangle(e.name);
      if (demangled === null || !demangled.startsWith(prefix)) {
        continue;
      }
      const parsed = parseSwiftSignature(demangled);
      if (parsed === null || parsed.kind !== "function") {
        continue;
      }
      const argTypes = parsed.argTypeNames.map((n) => {
        const metadata = resolveType(n);
        if (metadata === null) {
          throw new Error(`cannot resolve init argument type ${n}`);
        }
        return metadata;
      });
      this.initializer = { address: e.address, argTypes };
      return this.initializer;
    }
    throw new Error(`no __allocating_init found for ${fullName}`);
  }
}

export class TupleType extends SwiftType {
  get labels(): string | null {
    return tupleLabels(this.metadata);
  }

  get elements(): TupleElement[] {
    return [...enumerateTupleElements(this.metadata)];
  }
}

export class MetatypeType extends SwiftType {
  get instanceType(): SwiftType {
    return typeOf(metatypeInstanceType(this.metadata));
  }
}

export class FunctionType extends SwiftType {
  get signature(): FunctionSignature {
    return readFunctionType(this.metadata);
  }
}

export type NativeFunctionType =
  | SwiftType
  | Protocol
  | ProtocolComposition
  | SwiftArgType;

export function swiftNativeFunction(
  address: NativePointer,
  returnType: NativeFunctionType | null,
  argTypes: NativeFunctionType[],
  options: SwiftNativeFunctionOptions = {}
): SwiftNativeFunction {
  const lower = (t: NativeFunctionType): SwiftArgType => {
    if (t instanceof SwiftType) return t.metadata;
    if (t instanceof ProtocolComposition) return t.metadata;
    if (t instanceof Protocol) return new ProtocolComposition(t).metadata;
    return t;
  };
  return makeSwiftNativeFunction(
    address,
    returnType === null ? null : lower(returnType),
    argTypes.map(lower),
    options
  );
}

export function typeOf(metadata: Metadata): SwiftType {
  switch (metadata.kind) {
    case MetadataKind.Struct:
      return new StructType(metadata);
    case MetadataKind.Enum:
    case MetadataKind.Optional:
      return new EnumType(metadata);
    case MetadataKind.Class:
      return new ClassType(metadata);
    case MetadataKind.Tuple:
      return new TupleType(metadata);
    case MetadataKind.Metatype:
      return new MetatypeType(metadata);
    case MetadataKind.Function:
      return new FunctionType(metadata);
    case MetadataKind.ObjCClassWrapper:
      return new ObjCClassWrapperType(metadata);
    case MetadataKind.FixedArray:
    case MetadataKind.Borrow:
      throw new Error(`unsupported metadata kind ${MetadataKind[metadata.kind]}`);
    default:
      return new SwiftType(metadata);
  }
}
