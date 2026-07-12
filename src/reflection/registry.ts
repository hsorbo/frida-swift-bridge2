import { ContextDescriptor, ContextDescriptorKind } from "../abi/context-descriptor.js";
import {
  getSwiftSection,
  enumerateTypeContextDescriptors,
} from "../image/sections.js";

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

// Stale after dlclose, but Swift dylibs are effectively never unloaded.
const cachedTypesByModulePath = new Map<string, ContextDescriptor[]>();

function typesOf(module: Module): ContextDescriptor[] {
  let list = cachedTypesByModulePath.get(module.path);
  if (list === undefined) {
    list = [...enumerateTypes(module)];
    cachedTypesByModulePath.set(module.path, list);
  }
  return list;
}

export function* swiftModules(): Generator<Module> {
  yield* enumerateSwiftModules();
}

export function* swiftTypes(module?: Module): Generator<ContextDescriptor> {
  if (module !== undefined) {
    yield* typesOf(module);
    return;
  }
  for (const m of enumerateSwiftModules()) {
    yield* typesOf(m);
  }
}

function* typesByKind(kind: ContextDescriptorKind, module?: Module): Generator<ContextDescriptor> {
  for (const descriptor of swiftTypes(module)) {
    if (descriptor.kind === kind) {
      yield descriptor;
    }
  }
}

export function* swiftClasses(module?: Module): Generator<ContextDescriptor> {
  yield* typesByKind(ContextDescriptorKind.Class, module);
}

export function* swiftStructs(module?: Module): Generator<ContextDescriptor> {
  yield* typesByKind(ContextDescriptorKind.Struct, module);
}

export function* swiftEnums(module?: Module): Generator<ContextDescriptor> {
  yield* typesByKind(ContextDescriptorKind.Enum, module);
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
    for (const descriptor of typesOf(module)) {
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
