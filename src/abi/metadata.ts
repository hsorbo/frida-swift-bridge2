import { ContextDescriptor, ContextDescriptorKind } from "./context-descriptor.js";

export enum MetadataKind {
  Class = 0x0,
  Struct = 0x200,
  Enum = 0x201,
  Optional = 0x202,
}

const OFFSETOF_KIND = 0x0;
const LAST_ENUMERATED = 0x7ff;

const VWT_OFFSETOF_SIZE = 0x40;
const VWT_OFFSETOF_STRIDE = 0x48;
const VWT_OFFSETOF_FLAGS = 0x50;
const VWT_ALIGNMENT_MASK = 0xff;

const METADATA_REQUEST_COMPLETE = 0;

const OFFSETOF_VALUE_TYPE_GENERIC_HEADER = 0x24;
const OFFSETOF_NUM_KEY_ARGUMENTS = 0x4;

export interface TypeLayout {
  size: number;
  stride: number;
  alignment: number;
}

export class Metadata {
  constructor(readonly handle: NativePointer) {}

  get kind(): MetadataKind {
    const raw = this.handle.add(OFFSETOF_KIND).readU32();
    return raw > LAST_ENUMERATED ? MetadataKind.Class : raw;
  }

  get valueWitnessTable(): NativePointer {
    return this.handle.sub(Process.pointerSize).readPointer();
  }

  get description(): ContextDescriptor {
    return new ContextDescriptor(
      this.handle.add(Process.pointerSize).readPointer().strip()
    );
  }

  get genericArguments(): NativePointer {
    return this.handle.add(2 * Process.pointerSize);
  }

  get typeLayout(): TypeLayout {
    const vwt = this.valueWitnessTable;
    const flags = vwt.add(VWT_OFFSETOF_FLAGS).readU32();
    return {
      size: vwt.add(VWT_OFFSETOF_SIZE).readU64().toNumber(),
      stride: vwt.add(VWT_OFFSETOF_STRIDE).readU64().toNumber(),
      alignment: (flags & VWT_ALIGNMENT_MASK) + 1,
    };
  }
}

const cache = new Map<string, Metadata>();

export function getMetadata(descriptor: ContextDescriptor): Metadata {
  if (descriptor.isGeneric) {
    throw new Error("getMetadata requires type arguments for a generic type");
  }
  const accessFunction = descriptor.accessFunction;
  if (accessFunction === null) {
    throw new Error("descriptor has no metadata access function");
  }

  const key = descriptor.handle.toString();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const access = new NativeFunction(accessFunction, "pointer", ["size_t"]);
  const metadata = new Metadata(access(METADATA_REQUEST_COMPLETE) as NativePointer);
  cache.set(key, metadata);
  return metadata;
}

const genericCache = new Map<string, Metadata>();

export function getGenericMetadata(
  descriptor: ContextDescriptor,
  typeArguments: Metadata[]
): Metadata {
  const header = genericHeader(descriptor);
  const numParams = header.readU16();
  const numKeyArguments = header.add(OFFSETOF_NUM_KEY_ARGUMENTS).readU16();
  if (typeArguments.length !== numParams) {
    throw new Error(`expected ${numParams} type argument(s), got ${typeArguments.length}`);
  }
  if (numKeyArguments !== numParams) {
    throw new Error(
      "generic conformance requirements are not supported; use instantiateGenericMetadata"
    );
  }
  return instantiateGenericMetadata(descriptor, typeArguments.map((m) => m.handle));
}

export function instantiateGenericMetadata(
  descriptor: ContextDescriptor,
  keyArguments: NativePointer[]
): Metadata {
  const numKeyArguments = genericHeader(descriptor).add(OFFSETOF_NUM_KEY_ARGUMENTS).readU16();
  if (keyArguments.length !== numKeyArguments) {
    throw new Error(`expected ${numKeyArguments} key argument(s), got ${keyArguments.length}`);
  }

  const accessFunction = descriptor.accessFunction;
  if (accessFunction === null) {
    throw new Error("descriptor has no metadata access function");
  }

  const key =
    descriptor.handle.toString() + "<" + keyArguments.map((h) => h.toString()).join(",") + ">";
  const cached = genericCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const metadata = new Metadata(invokeAccessor(accessFunction, keyArguments));
  genericCache.set(key, metadata);
  return metadata;
}

function genericHeader(descriptor: ContextDescriptor): NativePointer {
  if (!descriptor.isGeneric) {
    throw new Error("not a generic type; use getMetadata");
  }
  const kind = descriptor.kind;
  if (kind !== ContextDescriptorKind.Struct && kind !== ContextDescriptorKind.Enum) {
    throw new Error(`generic metadata for descriptor kind ${kind} is not supported`);
  }
  return descriptor.handle.add(OFFSETOF_VALUE_TYPE_GENERIC_HEADER);
}

function invokeAccessor(fn: NativePointer, args: NativePointer[]): NativePointer {
  const request = METADATA_REQUEST_COMPLETE;
  switch (args.length) {
    case 1:
      return new NativeFunction(fn, "pointer", ["size_t", "pointer"])(
        request, args[0]
      ) as NativePointer;
    case 2:
      return new NativeFunction(fn, "pointer", ["size_t", "pointer", "pointer"])(
        request, args[0], args[1]
      ) as NativePointer;
    case 3:
      return new NativeFunction(fn, "pointer", ["size_t", "pointer", "pointer", "pointer"])(
        request, args[0], args[1], args[2]
      ) as NativePointer;
    default: {
      const buffer = Memory.alloc(args.length * Process.pointerSize);
      args.forEach((a, i) => buffer.add(i * Process.pointerSize).writePointer(a));
      return new NativeFunction(fn, "pointer", ["size_t", "pointer"])(
        request, buffer
      ) as NativePointer;
    }
  }
}
