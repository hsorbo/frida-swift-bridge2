import { Metadata, MetadataKind } from "../abi/metadata.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { readVTable, VTableEntry } from "../abi/class-descriptor.js";
import { Value } from "../abi/value.js";
import { HeapObject } from "../abi/heap-object.js";
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
  MethodInfo,
  MethodResolveOptions,
  bindStaticMethod,
  enumerateMethods,
  resolveMethod,
} from "./method.js";
import { demangle } from "./demangle.js";
import { typeName } from "./type-name.js";
import { getSwiftCoreApi } from "./api.js";
import { Protocol, ProtocolComposition } from "./protocol.js";

export interface TypeMember {
  name: string;
  type: Metadata | null;
}

export class SwiftType {
  constructor(readonly metadata: Metadata) {}

  get name(): string {
    return typeName(this.metadata);
  }

  get methods(): MethodInfo[] {
    return enumerateMethods(this.name);
  }
}

export class ValueType extends SwiftType {
  method(name: string, options: MethodResolveOptions = {}): BoundStaticMethod {
    return bindStaticMethod(this.metadata, name, options);
  }

  call(name: string, ...args: SwiftValue[]): SwiftValue {
    return this.method(name).call(...args);
  }
}

export class StructType extends ValueType {
  new(value: SwiftValue): Value {
    return Value.fromJS(this.metadata, value);
  }

  get fields(): TypeMember[] {
    return [...enumerateFields(this.metadata.description)].map((f) => ({
      name: f.name,
      type: fieldTypeIn(this.metadata, f),
    }));
  }
}

export class EnumType extends ValueType {
  case(name: string, payload?: SwiftValue): Value {
    return Value.fromJS(this.metadata, payload === undefined ? name : { [name]: payload });
  }

  get cases(): TypeMember[] {
    return [...enumerateFields(this.metadata.description)].map((f) => ({
      name: f.name,
      type: f.mangledTypeName !== null ? fieldTypeIn(this.metadata, f) : null,
    }));
  }
}

export class ClassType extends SwiftType {
  private initializer: { address: NativePointer; argTypes: Metadata[] } | null = null;
  private vtableEntries: VTableEntry[] | null = null;

  get vtable(): VTableEntry[] {
    if (this.vtableEntries === null) {
      this.vtableEntries = readVTable(new ClassMetadata(this.metadata.handle).description);
    }
    return this.vtableEntries;
  }

  init(...args: SwiftValue[]): HeapObject {
    const { address, argTypes } = this.resolveInitializer();
    if (args.length !== argTypes.length) {
      throw new Error(`init expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    const call = makeSwiftNativeFunction(address, this.metadata, argTypes, { hasSelf: true });
    const argPtrs = args.map((value, i) => {
      const buffer = Memory.alloc(argTypes[i].typeLayout.stride);
      writeValue(argTypes[i], buffer, value);
      return buffer;
    });
    return new HeapObject(call(this.metadata.handle, ...argPtrs)!.readPointer());
  }

  alloc(): HeapObject {
    const cls = new ClassMetadata(this.metadata.handle);
    const object = getSwiftCoreApi().swift_allocObject(
      cls.handle,
      cls.instanceSize,
      cls.instanceAlignment - 1
    );
    return new HeapObject(object);
  }

  method(name: string, options: MethodResolveOptions = {}): BoundMethod {
    return new BoundMethod(
      resolveMethod(this.fullName, name, { ...options, static: true }),
      this.metadata.handle
    );
  }

  call(name: string, ...args: SwiftValue[]): SwiftValue {
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
    default:
      return new SwiftType(metadata);
  }
}
