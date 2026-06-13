import { ContextDescriptor } from "./context-descriptor.js";

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
