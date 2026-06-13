import { ContextDescriptor } from "./context-descriptor.js";
import { Metadata } from "./metadata.js";
import { RelativeIndirectablePointer } from "../basic/relative-pointer.js";
import { getSwiftSection } from "../macho/sections.js";
import { enumerateSwiftModules } from "../reflection/registry.js";
import { getSwiftCoreApi } from "../runtime/api.js";

const RECORD_SIZE = 4;
const PROTOCOL_RECORD_INT_MASK = 0x2;

const OFFSETOF_CONF_PROTOCOL = 0x0;
const OFFSETOF_CONF_FLAGS = 0xc;

export class ProtocolConformance {
  constructor(readonly handle: NativePointer) {}

  get protocol(): ContextDescriptor | null {
    const p = RelativeIndirectablePointer.resolve(this.handle.add(OFFSETOF_CONF_PROTOCOL));
    return p === null ? null : new ContextDescriptor(p);
  }

  get flags(): number {
    return this.handle.add(OFFSETOF_CONF_FLAGS).readU32();
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
    for (const protocol of enumerateProtocols(module)) {
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
