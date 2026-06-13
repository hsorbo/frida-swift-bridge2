import { ContextDescriptor } from "../abi/context-descriptor.js";
import {
  getSwiftSection,
  enumerateTypeContextDescriptors,
} from "../macho/sections.js";

export function* enumerateSwiftModules(): Generator<Module> {
  for (const module of Process.enumerateModules()) {
    if (getSwiftSection(module, "__swift5_types") !== null) {
      yield module;
    }
  }
}

export function* enumerateTypes(module: Module): Generator<ContextDescriptor> {
  for (const handle of enumerateTypeContextDescriptors(module)) {
    const descriptor = new ContextDescriptor(handle);
    if (descriptor.isType) {
      yield descriptor;
    }
  }
}

const resolved = new Map<string, ContextDescriptor>();

export function findType(name: string): ContextDescriptor | null {
  const hit = resolved.get(name);
  if (hit !== undefined) {
    return hit;
  }

  const dot = name.lastIndexOf(".");
  const simpleName = dot === -1 ? name : name.slice(dot + 1);
  const moduleName = dot === -1 ? null : name.slice(0, dot);

  for (const module of enumerateSwiftModules()) {
    for (const descriptor of enumerateTypes(module)) {
      if (descriptor.name !== simpleName) {
        continue;
      }
      if (moduleName !== null && descriptor.moduleName !== moduleName) {
        continue;
      }
      resolved.set(name, descriptor);
      return descriptor;
    }
  }

  return null;
}
