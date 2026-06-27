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

const tableCache = new Map<string, MethodCandidate[]>();
const invokerCache = new Map<string, SwiftNativeFunction>();

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

// Misses methods defined in an extension in a different module than the type.
function methodTable(fullName: string): MethodCandidate[] {
  const cached = tableCache.get(fullName);
  if (cached !== undefined) {
    return cached;
  }
  const descriptor = findType(fullName)!;
  const module = Process.findModuleByAddress(descriptor.handle);
  if (module === null) {
    throw new Error(`no module owns ${fullName}`);
  }
  const candidates: MethodCandidate[] = [];
  for (const e of module.enumerateExports()) {
    const demangled = demangle(e.name);
    if (demangled === null) {
      continue;
    }
    const signature = parseSwiftSignature(demangled);
    if (signature === null || signature.kind !== "function") {
      continue;
    }
    const { context, isStatic } = stripReceiverKeyword(signature.context);
    if (context !== fullName) {
      continue;
    }
    candidates.push({ address: e.address, name: signature.name, isStatic, signature });
  }
  tableCache.set(fullName, candidates);
  return candidates;
}

export function enumerateMethods(typeName: string): MethodInfo[] {
  return methodTable(canonicalTypeName(typeName)).map((c) => ({
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
  let candidates = methodTable(fullName).filter(
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
    const argPtrs = args.map((value, i) => {
      const metadata = argTypes[i];
      const buffer = Memory.alloc(metadata.typeLayout.stride);
      if (metadata.kind === MetadataKind.Class) {
        buffer.writePointer(value as NativePointer);
      } else {
        writeValue(metadata, buffer, value);
      }
      return buffer;
    });
    const ret = this.fn(this.self, ...argPtrs);
    if (returnType === null || ret === null) {
      return null;
    }
    return readValue(returnType, ret);
  }
}
