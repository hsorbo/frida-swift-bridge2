import { ContextDescriptor } from "./context-descriptor.js";
import { Metadata } from "./metadata.js";
import {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "../basic/relative-pointer.js";
import { getSwiftSection } from "../image/sections.js";
import { enumerateSwiftModules } from "../reflection/registry.js";
import { getSwiftCoreApi } from "../runtime/api.js";

const RECORD_SIZE = 4;
const PROTOCOL_RECORD_INT_MASK = 0x2;

const OFFSETOF_CONF_PROTOCOL = 0x0;
const OFFSETOF_CONF_TYPE_REF = 0x4;
const OFFSETOF_CONF_FLAGS = 0xc;

const enum TypeReferenceKind {
  DirectTypeDescriptor = 0,
  IndirectTypeDescriptor = 1,
  DirectObjCClassName = 2,
  IndirectObjCClass = 3,
}

export class ProtocolConformance {
  constructor(readonly handle: NativePointer) {}

  get protocol(): ContextDescriptor | null {
    const p = RelativeIndirectablePointer.resolve(this.handle.add(OFFSETOF_CONF_PROTOCOL));
    return p === null ? null : new ContextDescriptor(p);
  }

  get flags(): number {
    return this.handle.add(OFFSETOF_CONF_FLAGS).readU32();
  }

  // Null for ObjC class references: those name a class, not a Swift nominal descriptor.
  get typeDescriptor(): NativePointer | null {
    const at = this.handle.add(OFFSETOF_CONF_TYPE_REF);
    switch ((this.flags >> 3) & 0x7) {
      case TypeReferenceKind.DirectTypeDescriptor:
        return RelativeDirectPointer.resolve(at);
      case TypeReferenceKind.IndirectTypeDescriptor: {
        const indirect = RelativeDirectPointer.resolve(at);
        return indirect === null ? null : indirect.readPointer().strip();
      }
      default:
        return null;
    }
  }
}

export function* enumerateProtocolConformances(module: Module): Generator<ProtocolConformance> {
  const section = getSwiftSection(module, "__swift5_proto");
  if (section === null) {
    return;
  }
  const count = section.size / RECORD_SIZE;
  for (let i = 0; i < count; i++) {
    const descriptor = RelativeIndirectablePointer.resolve(section.address.add(i * RECORD_SIZE));
    if (descriptor !== null) {
      yield new ProtocolConformance(descriptor);
    }
  }
}

export function* enumerateProtocols(module: Module): Generator<ContextDescriptor> {
  const section = getSwiftSection(module, "__swift5_protos");
  if (section === null) {
    return;
  }
  const count = section.size / RECORD_SIZE;
  for (let i = 0; i < count; i++) {
    const descriptor = resolveProtocolRecord(section.address.add(i * RECORD_SIZE));
    if (descriptor !== null) {
      yield new ContextDescriptor(descriptor);
    }
  }
}

function resolveProtocolRecord(record: NativePointer): NativePointer | null {
  const offset = record.readS32() & ~PROTOCOL_RECORD_INT_MASK;
  if (offset === 0) {
    return null;
  }
  const address = record.add(offset & ~1);
  return (offset & 1) !== 0 ? address.readPointer().strip() : address;
}

const cachedProtocolsByModulePath = new Map<string, ContextDescriptor[]>();

function protocolsOf(module: Module): ContextDescriptor[] {
  let list = cachedProtocolsByModulePath.get(module.path);
  if (list === undefined) {
    list = [...enumerateProtocols(module)];
    cachedProtocolsByModulePath.set(module.path, list);
  }
  return list;
}

export function* protocolDescriptors(module?: Module): Generator<ContextDescriptor> {
  if (module !== undefined) {
    yield* protocolsOf(module);
    return;
  }
  for (const m of enumerateSwiftModules()) {
    yield* protocolsOf(m);
  }
}

const resolvedProtocols = new Map<string, ContextDescriptor>();

export function findProtocol(name: string): ContextDescriptor | null {
  const hit = resolvedProtocols.get(name);
  if (hit !== undefined) {
    return hit;
  }

  const dot = name.lastIndexOf(".");
  const simpleName = dot === -1 ? name : name.slice(dot + 1);
  const moduleName = dot === -1 ? null : name.slice(0, dot);

  for (const module of enumerateSwiftModules()) {
    for (const protocol of protocolsOf(module)) {
      if (protocol.name !== simpleName) {
        continue;
      }
      if (moduleName !== null && protocol.moduleName !== moduleName) {
        continue;
      }
      resolvedProtocols.set(name, protocol);
      return protocol;
    }
  }

  return null;
}

export function conformsToProtocol(
  type: Metadata,
  protocol: ContextDescriptor
): NativePointer | null {
  const witnessTable = getSwiftCoreApi().swift_conformsToProtocol(type.handle, protocol.handle);
  return witnessTable.isNull() ? null : witnessTable;
}

const conformingProtocolsCache = new Map<string, ContextDescriptor[]>();

// Scans every Swift module so retroactive conformances declared outside the type's own module are
// included; memoized per type descriptor since the first pass is the costly part.
export function conformingProtocols(typeDescriptor: NativePointer): ContextDescriptor[] {
  const key = typeDescriptor.toString();
  const cached = conformingProtocolsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const protocols: ContextDescriptor[] = [];
  const seen = new Set<string>();
  for (const module of enumerateSwiftModules()) {
    for (const conformance of enumerateProtocolConformances(module)) {
      const descriptor = conformance.typeDescriptor;
      if (descriptor === null || !descriptor.equals(typeDescriptor)) {
        continue;
      }
      const protocol = conformance.protocol;
      if (protocol === null || seen.has(protocol.handle.toString())) {
        continue;
      }
      seen.add(protocol.handle.toString());
      protocols.push(protocol);
    }
  }
  conformingProtocolsCache.set(key, protocols);
  return protocols;
}

const conformingTypesCache = new Map<string, ContextDescriptor[]>();

export function conformingTypes(protocol: ContextDescriptor): ContextDescriptor[] {
  const key = protocol.handle.toString();
  const cached = conformingTypesCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const types: ContextDescriptor[] = [];
  const seen = new Set<string>();
  for (const module of enumerateSwiftModules()) {
    for (const conformance of enumerateProtocolConformances(module)) {
      const p = conformance.protocol;
      if (p === null || !p.handle.equals(protocol.handle)) {
        continue;
      }
      const handle = conformance.typeDescriptor;
      if (handle === null || seen.has(handle.toString())) {
        continue;
      }
      seen.add(handle.toString());
      types.push(new ContextDescriptor(handle));
    }
  }
  conformingTypesCache.set(key, types);
  return types;
}
