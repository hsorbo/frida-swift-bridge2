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
  const qualified = dot === -1 ? null : name;

  // A qualified name resolves to the first full-path match. A bare name is accepted only when it
  // resolves uniquely across loaded images, so it must scan every image before committing. Distinct
  // descriptors that share a qualified name denote the same type (dyld cache aliases), not ambiguity.
  let match: ContextDescriptor | null = null;
  let matchName: string | null = null;
  for (const module of enumerateSwiftModules()) {
    for (const descriptor of typesOf(module)) {
      if (descriptor.name !== simpleName) {
        continue;
      }
      if (qualified !== null) {
        if (descriptor.fullTypeName !== qualified) {
          continue;
        }
        resolved.set(name, descriptor);
        return descriptor;
      }
      const fullName = descriptor.fullTypeName;
      if (fullName === null) {
        continue;
      }
      if (match !== null && fullName !== matchName) {
        throw new Error(`ambiguous type name "${name}"; qualify it with a module`);
      }
      match = descriptor;
      matchName = fullName;
    }
  }

  // Never cached: a later-loaded image can make a bare name ambiguous.
  return match;
}
