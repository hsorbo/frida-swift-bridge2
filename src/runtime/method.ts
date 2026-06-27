import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, writeValue, SwiftValue } from "../abi/instance.js";
import { findType } from "../reflection/registry.js";
import { demangle } from "./demangle.js";
import { parseSwiftSignature, resolveType, SwiftFunctionSignature } from "./symbolication.js";
import { makeSwiftNativeFunction, SwiftNativeFunction } from "./calling-convention.js";

export type MethodKind = "method" | "init";

export interface MethodInfo {
  name: string;
  kind: MethodKind;
  isStatic: boolean;
  address: NativePointer;
  argTypeNames: string[];
  argLabels: (string | null)[];
  returnTypeName: string | null;
  selector: string;
}

export interface ResolvedMethod {
  address: NativePointer;
  argTypes: Metadata[];
  returnType: Metadata | null;
  throws: boolean;
  isStatic: boolean;
  selector: string;
}

export interface MethodResolveOptions {
  arity?: number;
  static?: boolean;
}

interface MethodCandidate {
  address: NativePointer;
  name: string;
  isStatic: boolean;
  signature: SwiftFunctionSignature;
}

export type AccessorKind = "getter" | "setter";

interface AccessorCandidate {
  address: NativePointer;
  member: string;
  kind: AccessorKind;
  typeName: string;
}

interface TypeMembers {
  methods: MethodCandidate[];
  accessors: AccessorCandidate[];
}

const tableCache = new Map<string, TypeMembers>();
const invokerCache = new Map<string, SwiftNativeFunction>();

function marshalArg(metadata: Metadata, value: SwiftValue): NativePointer {
  const buffer = Memory.alloc(metadata.typeLayout.stride);
  if (metadata.kind === MetadataKind.Class) {
    buffer.writePointer(value as NativePointer);
  } else {
    writeValue(metadata, buffer, value);
  }
  return buffer;
}

function decodeReturn(returnType: Metadata | null, ret: NativePointer | null): SwiftValue {
  if (returnType === null || ret === null) {
    return null;
  }
  return readValue(returnType, ret);
}

function stripReceiverKeyword(context: string): { context: string; isStatic: boolean } {
  for (const keyword of ["static ", "class "]) {
    if (context.startsWith(keyword)) {
      return { context: context.slice(keyword.length), isStatic: true };
    }
  }
  return { context, isStatic: false };
}

function methodKind(name: string): MethodKind {
  return name === "init" || name === "__allocating_init" ? "init" : "method";
}

function canonicalTypeName(typeName: string): string {
  const descriptor = findType(typeName);
  if (descriptor === null) {
    throw new Error(`unknown type: ${typeName}`);
  }
  const full = descriptor.fullTypeName;
  if (full === null) {
    throw new Error(`type ${typeName} has no full name`);
  }
  return full;
}

// Misses members defined in an extension in a different module than the type.
function typeMembers(fullName: string): TypeMembers {
  const cached = tableCache.get(fullName);
  if (cached !== undefined) {
    return cached;
  }
  const descriptor = findType(fullName)!;
  const module = Process.findModuleByAddress(descriptor.handle);
  if (module === null) {
    throw new Error(`no module owns ${fullName}`);
  }
  const methods: MethodCandidate[] = [];
  const accessors: AccessorCandidate[] = [];
  for (const e of module.enumerateExports()) {
    const demangled = demangle(e.name);
    if (demangled === null) {
      continue;
    }
    const signature = parseSwiftSignature(demangled);
    if (signature === null) {
      continue;
    }
    if (signature.kind === "function") {
      const { context, isStatic } = stripReceiverKeyword(signature.context);
      if (context === fullName) {
        methods.push({ address: e.address, name: signature.name, isStatic, signature });
      }
    } else if (signature.kind !== "modify") {
      const { context } = stripReceiverKeyword(signature.context);
      if (context === fullName) {
        accessors.push({ address: e.address, member: signature.member, kind: signature.kind, typeName: signature.typeName });
      }
    }
  }
  const members: TypeMembers = { methods, accessors };
  tableCache.set(fullName, members);
  return members;
}

export function enumerateMethods(typeName: string): MethodInfo[] {
  return typeMembers(canonicalTypeName(typeName)).methods.map((c) => ({
    name: c.name,
    kind: methodKind(c.name),
    isStatic: c.isStatic,
    address: c.address,
    argTypeNames: c.signature.argTypeNames,
    argLabels: c.signature.argLabels,
    returnTypeName: c.signature.returnTypeName,
    selector: c.signature.selector,
  }));
}

export function resolveMethod(
  typeName: string,
  methodName: string,
  options: MethodResolveOptions = {}
): ResolvedMethod {
  const fullName = canonicalTypeName(typeName);
  let candidates = typeMembers(fullName).methods.filter(
    (c) => c.name === methodName && c.signature.genericParams.length === 0
  );
  if (options.static !== undefined) {
    candidates = candidates.filter((c) => c.isStatic === options.static);
  }
  if (options.arity !== undefined) {
    candidates = candidates.filter((c) => c.signature.argTypeNames.length === options.arity);
  }

  if (candidates.length === 0) {
    throw new Error(`no method ${methodName} on ${fullName}`);
  }
  if (candidates.length > 1) {
    const selectors = candidates.map((c) => c.signature.selector).join(", ");
    throw new Error(
      `ambiguous method ${methodName} on ${fullName}: ${selectors} (disambiguate with { arity })`
    );
  }

  const { address, isStatic, signature } = candidates[0];
  const argTypes = signature.argTypeNames.map((name) => {
    const metadata = resolveType(name);
    if (metadata === null) {
      throw new Error(`cannot resolve argument type ${name} of ${signature.selector}`);
    }
    return metadata;
  });
  let returnType: Metadata | null = null;
  if (signature.returnTypeName !== null) {
    returnType = resolveType(signature.returnTypeName);
    if (returnType === null) {
      throw new Error(`cannot resolve return type ${signature.returnTypeName} of ${signature.selector}`);
    }
  }
  return { address, argTypes, returnType, throws: signature.throws, isStatic, selector: signature.selector };
}

function invokerFor(resolved: ResolvedMethod): SwiftNativeFunction {
  const key = resolved.address.toString();
  let fn = invokerCache.get(key);
  if (fn === undefined) {
    fn = makeSwiftNativeFunction(resolved.address, resolved.returnType, resolved.argTypes, {
      hasSelf: true,
      throws: resolved.throws,
    });
    invokerCache.set(key, fn);
  }
  return fn;
}

export class BoundMethod {
  private readonly fn: SwiftNativeFunction;

  constructor(
    readonly resolved: ResolvedMethod,
    private readonly self: NativePointer
  ) {
    this.fn = invokerFor(resolved);
  }

  get address(): NativePointer {
    return this.resolved.address;
  }

  get raw(): SwiftNativeFunction {
    return this.fn;
  }

  call(...args: SwiftValue[]): SwiftValue {
    const { argTypes, returnType } = this.resolved;
    if (args.length !== argTypes.length) {
      throw new Error(`${this.resolved.selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    const argPtrs = args.map((value, i) => marshalArg(argTypes[i], value));
    return decodeReturn(returnType, this.fn(this.self, ...argPtrs));
  }
}

interface ResolvedAccessor {
  address: NativePointer;
  type: Metadata;
  kind: AccessorKind;
}

function resolveAccessor(typeName: string, member: string, kind: AccessorKind): ResolvedAccessor {
  const fullName = canonicalTypeName(typeName);
  const candidate = typeMembers(fullName).accessors.find((a) => a.member === member && a.kind === kind);
  if (candidate === undefined) {
    throw new Error(`no ${kind} for ${member} on ${fullName}`);
  }
  const type = resolveType(candidate.typeName);
  if (type === null) {
    throw new Error(`cannot resolve ${kind} type ${candidate.typeName} of ${fullName}.${member}`);
  }
  return { address: candidate.address, type, kind };
}

function invokerForAccessor(accessor: ResolvedAccessor): SwiftNativeFunction {
  const key = accessor.address.toString();
  let fn = invokerCache.get(key);
  if (fn === undefined) {
    fn =
      accessor.kind === "getter"
        ? makeSwiftNativeFunction(accessor.address, accessor.type, [], { hasSelf: true })
        : makeSwiftNativeFunction(accessor.address, null, [accessor.type], { hasSelf: true });
    invokerCache.set(key, fn);
  }
  return fn;
}

export function getProperty(self: NativePointer, typeName: string, member: string): SwiftValue {
  const accessor = resolveAccessor(typeName, member, "getter");
  return decodeReturn(accessor.type, invokerForAccessor(accessor)(self));
}

export function setProperty(self: NativePointer, typeName: string, member: string, value: SwiftValue): void {
  const accessor = resolveAccessor(typeName, member, "setter");
  invokerForAccessor(accessor)(self, marshalArg(accessor.type, value));
}
