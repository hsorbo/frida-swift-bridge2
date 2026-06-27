import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, writeValue, SwiftValue } from "../abi/instance.js";
import { findType } from "../reflection/registry.js";
import { demangle } from "./demangle.js";
import { parseSwiftSignature, resolveType, SwiftFunctionSignature } from "./symbolication.js";
import {
  makeSwiftNativeFunction,
  SwiftNativeFunction,
  SwiftArgType,
  shouldPassIndirectly,
} from "./calling-convention.js";
import { typeName } from "./type-name.js";
import { findProtocol, conformsToProtocol } from "../abi/protocol-conformance.js";

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
  typeArguments?: Metadata[]; // present ⇒ resolve a generic method; one entry per generic parameter
  witnessTables?: NativePointer[]; // overrides the witnesses auto-resolved from the where-clause
}

// mutating is unrecoverable from the symbol; the caller supplies it. It only changes self routing
// for small loadable receivers — large/non-POD receivers pass self in x20 either way.
export interface ValueMethodResolveOptions extends MethodResolveOptions {
  mutating?: boolean;
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

function valueInvoker(resolved: ResolvedMethod, receiver: Metadata, indirectSelf: boolean): SwiftNativeFunction {
  const key = `${resolved.address}:${indirectSelf ? "i" : "d"}`;
  let fn = invokerCache.get(key);
  if (fn === undefined) {
    fn = indirectSelf
      ? makeSwiftNativeFunction(resolved.address, resolved.returnType, resolved.argTypes, {
          hasSelf: true,
          throws: resolved.throws,
        })
      : makeSwiftNativeFunction(resolved.address, resolved.returnType, [...resolved.argTypes, receiver], {
          throws: resolved.throws,
        });
    invokerCache.set(key, fn);
  }
  return fn;
}

// Value-type self: x20 pointer when formally indirect (mutating inout, or large/non-POD borrowed) —
// mutation lands in the receiver buffer in place; otherwise self rides as the trailing exploded arg.
export class BoundValueMethod {
  private readonly fn: SwiftNativeFunction;
  private readonly indirectSelf: boolean;

  constructor(
    readonly resolved: ResolvedMethod,
    private readonly receiver: Metadata,
    private readonly self: NativePointer,
    mutating: boolean
  ) {
    this.indirectSelf = mutating || shouldPassIndirectly(receiver);
    this.fn = valueInvoker(resolved, receiver, this.indirectSelf);
  }

  get address(): NativePointer {
    return this.resolved.address;
  }

  call(...args: SwiftValue[]): SwiftValue {
    const { argTypes, returnType } = this.resolved;
    if (args.length !== argTypes.length) {
      throw new Error(`${this.resolved.selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    const argPtrs = args.map((value, i) => marshalArg(argTypes[i], value));
    const ret = this.indirectSelf ? this.fn(this.self, ...argPtrs) : this.fn(...argPtrs, this.self);
    return decodeReturn(returnType, ret);
  }
}

export function bindValueMethod(
  receiver: Metadata,
  self: NativePointer,
  name: string,
  options: ValueMethodResolveOptions = {}
): BoundValueMethod {
  const resolved = resolveMethod(typeName(receiver), name, options);
  return new BoundValueMethod(resolved, receiver, self, options.mutating === true);
}

type ArgPlan = { generic: true; index: number; metadata: Metadata } | { generic: false; metadata: Metadata };

function planGenericType(name: string, genericParams: string[], typeArguments: Metadata[]): ArgPlan {
  const index = genericParams.indexOf(name);
  if (index !== -1) {
    const metadata = typeArguments[index];
    if (metadata === undefined) {
      throw new Error(`missing type argument for generic parameter ${name}`);
    }
    return { generic: true, index, metadata };
  }
  const metadata = resolveType(name);
  if (metadata === null) {
    throw new Error(`unsupported generic signature type ${name} (only bare parameters and concrete types are supported)`);
  }
  return { generic: false, metadata };
}

function swiftArgType(plan: ArgPlan): SwiftArgType {
  return plan.generic ? { genericParam: plan.index } : plan.metadata;
}

function autoWitnessTables(
  signature: SwiftFunctionSignature,
  typeArguments: Metadata[]
): NativePointer[] {
  return signature.conformanceRequirements.map((req) => {
    const index = signature.genericParams.indexOf(req.subject);
    const protocol = index === -1 ? null : findProtocol(req.protocol);
    if (protocol === null) {
      throw new Error(`cannot resolve protocol ${req.protocol} for requirement ${req.subject}`);
    }
    const witnessTable = conformsToProtocol(typeArguments[index], protocol);
    if (witnessTable === null) {
      throw new Error(`${typeName(typeArguments[index])} does not conform to ${req.protocol}`);
    }
    return witnessTable;
  });
}

export class GenericBoundMethod {
  private readonly fn: SwiftNativeFunction;

  constructor(
    private readonly argPlans: ArgPlan[],
    private readonly returnPlan: ArgPlan | null,
    readonly address: NativePointer,
    readonly selector: string,
    private readonly self: NativePointer,
    throws: boolean,
    typeArguments: Metadata[],
    witnessTables: NativePointer[]
  ) {
    this.fn = makeSwiftNativeFunction(
      address,
      returnPlan === null ? null : swiftArgType(returnPlan),
      argPlans.map(swiftArgType),
      { hasSelf: true, throws, typeArguments, witnessTables }
    );
  }

  call(...args: SwiftValue[]): SwiftValue {
    if (args.length !== this.argPlans.length) {
      throw new Error(`${this.selector} expects ${this.argPlans.length} argument(s), got ${args.length}`);
    }
    const argPtrs = args.map((value, i) => marshalArg(this.argPlans[i].metadata, value));
    return decodeReturn(this.returnPlan?.metadata ?? null, this.fn(this.self, ...argPtrs));
  }
}

export function bindGenericMethod(
  typeName: string,
  methodName: string,
  self: NativePointer,
  options: MethodResolveOptions = {}
): GenericBoundMethod {
  const typeArguments = options.typeArguments ?? [];
  const fullName = canonicalTypeName(typeName);
  let candidates = typeMembers(fullName).methods.filter(
    (c) => c.name === methodName && c.signature.genericParams.length > 0 && c.signature.simpleGenerics
  );
  if (options.static !== undefined) {
    candidates = candidates.filter((c) => c.isStatic === options.static);
  }
  if (options.arity !== undefined) {
    candidates = candidates.filter((c) => c.signature.argTypeNames.length === options.arity);
  }
  if (candidates.length === 0) {
    throw new Error(`no generic method ${methodName} on ${fullName}`);
  }
  if (candidates.length > 1) {
    const selectors = candidates.map((c) => c.signature.selector).join(", ");
    throw new Error(`ambiguous generic method ${methodName} on ${fullName}: ${selectors} (disambiguate with { arity })`);
  }

  const { address, signature } = candidates[0];
  if (typeArguments.length !== signature.genericParams.length) {
    throw new Error(`${signature.selector} needs ${signature.genericParams.length} type argument(s), got ${typeArguments.length}`);
  }
  const argPlans = signature.argTypeNames.map((n) => planGenericType(n, signature.genericParams, typeArguments));
  const returnPlan =
    signature.returnTypeName === null
      ? null
      : planGenericType(signature.returnTypeName, signature.genericParams, typeArguments);
  const witnessTables = options.witnessTables ?? autoWitnessTables(signature, typeArguments);
  return new GenericBoundMethod(argPlans, returnPlan, address, signature.selector, self, signature.throws, typeArguments, witnessTables);
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
