import { Metadata, MetadataKind } from "./metadata.js";
import { ContextDescriptor } from "./context-descriptor.js";
import { dynamicTypeOf } from "./class-metadata.js";
import { getSwiftCoreApi } from "../runtime/api.js";

const FLAGS_OFFSET = Process.pointerSize;
const NUM_PROTOCOLS_OFFSET = Process.pointerSize + 4;
const TYPE_OFFSET = 3 * Process.pointerSize;

const SPECIAL_PROTOCOL_MASK = 0x3f000000;
const SPECIAL_PROTOCOL_ERROR = 0x01000000;
const NOT_CLASS_CONSTRAINED = 0x80000000;
const HAS_SUPERCLASS_CONSTRAINT = 0x40000000;
const PROTOCOL_DESCRIPTOR_REF_IS_OBJC = 1;

export type ExistentialRepresentation = "opaque" | "class" | "error";

export function existentialRepresentation(metadata: Metadata): ExistentialRepresentation {
  const flags = metadata.handle.add(FLAGS_OFFSET).readU32();
  if ((flags & SPECIAL_PROTOCOL_MASK) === SPECIAL_PROTOCOL_ERROR) {
    return "error";
  }
  return (flags & NOT_CLASS_CONSTRAINED) !== 0 ? "opaque" : "class";
}

export interface OpaqueExistential {
  type: Metadata;
  value: NativePointer;
}

export function projectOpaqueExistential(container: NativePointer): OpaqueExistential {
  const type = new Metadata(container.add(TYPE_OFFSET).readPointer());
  return { type, value: type.valueWitnesses.projectBuffer(container) };
}

export function projectClassExistential(container: NativePointer): OpaqueExistential {
  const value = container.readPointer();
  return { type: dynamicTypeOf(value), value };
}

export enum ExtendedExistentialSpecialKind {
  None = 0,
  Class = 1,
  Metatype = 2,
  ExplicitLayout = 3,
}

export function extendedExistentialSpecialKind(metadata: Metadata): ExtendedExistentialSpecialKind {
  const shape = metadata.handle.add(Process.pointerSize).readPointer().strip();
  return shape.readU32() & 0xff;
}

export function isClassExistential(metadata: Metadata): boolean {
  return metadata.kind === MetadataKind.ExtendedExistential
    ? extendedExistentialSpecialKind(metadata) === ExtendedExistentialSpecialKind.Class
    : existentialRepresentation(metadata) === "class";
}

export function projectExistentialValue(metadata: Metadata, container: NativePointer): OpaqueExistential {
  if (metadata.kind === MetadataKind.ExtendedExistential) {
    switch (extendedExistentialSpecialKind(metadata)) {
      case ExtendedExistentialSpecialKind.None:
        return projectOpaqueExistential(container);
      case ExtendedExistentialSpecialKind.Class:
        return projectClassExistential(container);
      default:
        throw new Error("projectExistentialValue: only opaque and class extended existentials are supported");
    }
  }
  const representation = existentialRepresentation(metadata);
  if (representation === "class") {
    return projectClassExistential(container);
  }
  if (representation === "opaque") {
    return projectOpaqueExistential(container);
  }
  throw new Error("projectExistentialValue: Error existentials are not supported; use projectErrorExistential");
}

// Swift protocol descriptors of an Existential-kind metadata; ObjC refs (low bit set) are skipped.
export function existentialProtocols(metadata: Metadata): ContextDescriptor[] {
  const flags = metadata.handle.add(FLAGS_OFFSET).readU32();
  const numProtocols = metadata.handle.add(NUM_PROTOCOLS_OFFSET).readU32();
  let cursor = metadata.handle.add(NUM_PROTOCOLS_OFFSET + 4);
  if ((flags & HAS_SUPERCLASS_CONSTRAINT) !== 0) {
    cursor = cursor.add(Process.pointerSize);
  }
  const protocols: ContextDescriptor[] = [];
  for (let i = 0; i < numProtocols; i++) {
    const ref = cursor.add(i * Process.pointerSize).readPointer();
    if (!ref.and(PROTOCOL_DESCRIPTOR_REF_IS_OBJC).isNull()) {
      continue;
    }
    protocols.push(new ContextDescriptor(ref));
  }
  return protocols;
}

export function projectErrorExistential(container: NativePointer): OpaqueExistential {
  const errorBox = container.readPointer();
  const bridgedNSErrorScratch = Memory.alloc(Process.pointerSize);
  const result = Memory.alloc(3 * Process.pointerSize);
  getSwiftCoreApi().swift_getErrorValue(errorBox, bridgedNSErrorScratch, result);
  return {
    value: result.readPointer(),
    type: new Metadata(result.add(Process.pointerSize).readPointer()),
  };
}

// ProtocolClassConstraint ABI value: Class = 0 (class-only), Any = 1.
export function protocolClassConstraint(descriptor: ContextDescriptor): number {
  return (descriptor.flags >>> 16) & 0x1;
}

export function getExistentialTypeMetadata(protocols: ContextDescriptor[]): Metadata {
  // swift_getExistentialTypeMetadata trusts the caller to pre-sort the protocol list by the
  // compiler's canonical order (module name, then protocol name); otherwise the runtime uniques
  // a distinct-but-equivalent instance that won't pointer-match compiler-emitted existentials.
  const sorted = [...protocols].sort(compareProtocolDescriptors);
  const refs = Memory.alloc(Process.pointerSize * Math.max(sorted.length, 1));
  sorted.forEach((p, i) => refs.add(i * Process.pointerSize).writePointer(p.handle));
  const classConstraint =
    sorted.length === 0 ? 1 : Math.min(...sorted.map(protocolClassConstraint));
  const handle = getSwiftCoreApi().swift_getExistentialTypeMetadata(
    classConstraint,
    ptr(0),
    sorted.length,
    refs
  );
  return new Metadata(handle);
}

function compareProtocolDescriptors(a: ContextDescriptor, b: ContextDescriptor): number {
  const am = a.moduleName ?? "";
  const bm = b.moduleName ?? "";
  if (am !== bm) return am < bm ? -1 : 1;
  const an = a.name ?? "";
  const bn = b.name ?? "";
  return an === bn ? 0 : an < bn ? -1 : 1;
}
