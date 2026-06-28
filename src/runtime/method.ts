import { Metadata, MetadataKind, getMetadata } from "../abi/metadata.js";
import { ContextDescriptorKind } from "../abi/context-descriptor.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { HeapObject } from "../abi/heap-object.js";
import { createObject, SwiftObject } from "./object-facade.js";
import { Value } from "../abi/value.js";
import { readValue, writeValue, containsClassReference, SwiftValue } from "../abi/instance.js";
import { findType } from "../reflection/registry.js";
import { demangle } from "./demangle.js";
import { parseSwiftSignature, resolveType, resolveTypeExpr, splitBoundTypeName, SwiftFunctionSignature } from "./symbolication.js";
import {
  makeSwiftNativeFunction,
  SwiftNativeFunction,
  SwiftArgType,
  shouldPassIndirectly,
} from "./calling-convention.js";
import { typeName } from "./type-name.js";
import { findProtocol, conformsToProtocol } from "../abi/protocol-conformance.js";

export type MethodKind = "method" | "init";

export type CallResult = SwiftValue | SwiftObject | Value;

// A high-level argument: a JS-constructible value, or an opaque Value byte-copied in (e.g. an Array).
export type CallArg = SwiftValue | Value;

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
  labels?: (string | null)[]; // null = unlabelled
  argTypes?: string[]; // exact match against the signature's demangled argument-type names
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

function marshalArg(metadata: Metadata, value: CallArg): NativePointer {
  const buffer = Memory.alloc(metadata.typeLayout.stride);
  if (value instanceof Value) {
    if (!value.metadata.handle.equals(metadata.handle)) {
      throw new Error(`argument is a ${typeName(value.metadata)} value, expected ${typeName(metadata)}`);
    }
    value.copyInto(buffer);
  } else if (metadata.kind === MetadataKind.Class) {
    buffer.writePointer(value as NativePointer);
  } else {
    writeValue(metadata, buffer, value);
  }
  return buffer;
}

// Returns are +1: adopt a class; destroy a read non-POD temp; POD owns nothing. A value embedding a
// class ref would dangle on that destroy, so hand back an owned Value (deferred destroy) instead.
function decodeReturn(returnType: Metadata | null, ret: NativePointer | null): CallResult {
  if (returnType === null || ret === null) {
    return null;
  }
  if (returnType.kind === MetadataKind.Class) {
    return createObject(HeapObject.adopt(ret.readPointer()));
  }
  if (!returnType.valueWitnesses.isPOD && containsClassReference(returnType)) {
    return Value.adopt(returnType, ret);
  }
  const value = readValue(returnType, ret);
  if (!returnType.valueWitnesses.isPOD) {
    returnType.valueWitnesses.destroy(ret);
  }
  return value;
}

// +0/guaranteed args: the callee borrows, so each non-POD value temp is ours to destroy post-call
// (try/finally covers a throwing callee). An explicitly-__owned param would double-free — known gap.
function callBorrowingArgs(
  argTypes: Metadata[],
  args: CallArg[],
  returnType: Metadata | null,
  invoke: (argPtrs: NativePointer[]) => NativePointer | null
): CallResult {
  const argPtrs = args.map((value, i) => marshalArg(argTypes[i], value));
  try {
    return decodeReturn(returnType, invoke(argPtrs));
  } finally {
    for (let i = 0; i < argTypes.length; i++) {
      const metadata = argTypes[i];
      if (metadata.kind !== MetadataKind.Class && !metadata.valueWitnesses.isPOD) {
        metadata.valueWitnesses.destroy(argPtrs[i]);
      }
    }
  }
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

function sequenceEqual<T>(actual: T[], wanted: T[]): boolean {
  return actual.length === wanted.length && actual.every((value, i) => value === wanted[i]);
}

function applyOverloadFilters<T extends { isStatic: boolean; signature: SwiftFunctionSignature }>(
  candidates: T[],
  options: MethodResolveOptions
): T[] {
  if (options.static !== undefined) {
    candidates = candidates.filter((c) => c.isStatic === options.static);
  }
  if (options.arity !== undefined) {
    candidates = candidates.filter((c) => c.signature.argTypeNames.length === options.arity);
  }
  if (options.labels !== undefined) {
    candidates = candidates.filter((c) => sequenceEqual(c.signature.argLabels, options.labels!));
  }
  if (options.argTypes !== undefined) {
    candidates = candidates.filter((c) => sequenceEqual(c.signature.argTypeNames, options.argTypes!));
  }
  return candidates;
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

// typeMembers keys a method to its declaring class, so inherited ones need the superclass chain.
// Most-derived first; non-class/generic types collapse to one level.
function classChainNames(fullName: string): string[] {
  const descriptor = findType(fullName);
  if (descriptor === null || descriptor.kind !== ContextDescriptorKind.Class || descriptor.isGeneric) {
    return [fullName];
  }
  const names: string[] = [];
  let cls: ClassMetadata | null = new ClassMetadata(getMetadata(descriptor).handle);
  while (cls !== null && cls.isTypeMetadata) {
    const name = cls.description.fullTypeName;
    if (name === null) {
      break;
    }
    names.push(name);
    cls = cls.superclass;
  }
  return names.length === 0 ? [fullName] : names;
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
  const seen = new Set<string>();
  const methods: MethodInfo[] = [];
  for (const className of classChainNames(canonicalTypeName(typeName))) {
    for (const c of typeMembers(className).methods) {
      const key = `${c.isStatic ? "s" : "i"}:${c.signature.selector}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      methods.push({
        name: c.name,
        kind: methodKind(c.name),
        isStatic: c.isStatic,
        address: c.address,
        argTypeNames: c.signature.argTypeNames,
        argLabels: c.signature.argLabels,
        returnTypeName: c.signature.returnTypeName,
        selector: c.signature.selector,
      });
    }
  }
  return methods;
}

export function resolveMethod(
  typeName: string,
  methodName: string,
  options: MethodResolveOptions = {}
): ResolvedMethod {
  const fullName = canonicalTypeName(typeName);
  for (const className of classChainNames(fullName)) {
    const candidates = applyOverloadFilters(
      typeMembers(className).methods.filter(
        (c) => c.name === methodName && c.signature.genericParams.length === 0
      ),
      options
    );
    if (candidates.length === 0) {
      continue;
    }
    if (candidates.length > 1) {
      const overloads = candidates
        .map((c) => `${c.signature.selector} (${c.signature.argTypeNames.join(", ")})`)
        .join(", ");
      throw new Error(
        `ambiguous method ${methodName} on ${className}: ${overloads} (disambiguate with { arity }, { labels }, or { argTypes })`
      );
    }

    const { address, isStatic, signature } = candidates[0];
    const argTypes = signature.argTypeNames.map((name) => {
      const metadata = resolveTypeExpr(name, () => null);
      if (metadata === null) {
        throw new Error(`cannot resolve argument type ${name} of ${signature.selector}`);
      }
      return metadata;
    });
    let returnType: Metadata | null = null;
    if (signature.returnTypeName !== null) {
      returnType = resolveTypeExpr(signature.returnTypeName, () => null);
      if (returnType === null) {
        throw new Error(`cannot resolve return type ${signature.returnTypeName} of ${signature.selector}`);
      }
    }
    return { address, argTypes, returnType, throws: signature.throws, isStatic, selector: signature.selector };
  }
  throw new Error(`no method ${methodName} on ${fullName}`);
}

// Keyed by full signature, not bare address: an index invocation must not reuse a symbol-route
// invoker built for different types at the same impl.
function instanceInvokerKey(resolved: ResolvedMethod): string {
  const ret = resolved.returnType === null ? "v" : resolved.returnType.handle.toString();
  const args = resolved.argTypes.map((t) => t.handle.toString()).join(",");
  return `${resolved.address}|self|${ret}|${args}|${resolved.throws ? "t" : "n"}`;
}

function invokerFor(resolved: ResolvedMethod): SwiftNativeFunction {
  const key = instanceInvokerKey(resolved);
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

  call(...args: CallArg[]): CallResult {
    const { argTypes, returnType } = this.resolved;
    if (args.length !== argTypes.length) {
      throw new Error(`${this.resolved.selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    return callBorrowingArgs(argTypes, args, returnType, (argPtrs) => this.fn(this.self, ...argPtrs));
  }
}

function staticInvokerFor(resolved: ResolvedMethod): SwiftNativeFunction {
  const key = `${resolved.address}:static`;
  let fn = invokerCache.get(key);
  if (fn === undefined) {
    fn = makeSwiftNativeFunction(resolved.address, resolved.returnType, resolved.argTypes, {
      throws: resolved.throws,
    });
    invokerCache.set(key, fn);
  }
  return fn;
}

// Thin metatype: no self passed.
export class BoundStaticMethod {
  private readonly fn: SwiftNativeFunction;

  constructor(readonly resolved: ResolvedMethod) {
    this.fn = staticInvokerFor(resolved);
  }

  get address(): NativePointer {
    return this.resolved.address;
  }

  call(...args: CallArg[]): CallResult {
    const { argTypes, returnType } = this.resolved;
    if (args.length !== argTypes.length) {
      throw new Error(`${this.resolved.selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    return callBorrowingArgs(argTypes, args, returnType, (argPtrs) => this.fn(...argPtrs));
  }
}

export function bindStaticMethod(
  receiver: Metadata,
  name: string,
  options: MethodResolveOptions = {}
): BoundStaticMethod {
  return new BoundStaticMethod(resolveMethod(typeName(receiver), name, { ...options, static: true }));
}

type SelfRouting = { indirect: true } | { indirect: false; receiver: Metadata };

// Value self is indirect (x20) when mutating/inout or large/non-POD; else it rides as a trailing arg.
function valueSelfRouting(receiver: Metadata, mutating: boolean): SelfRouting {
  return mutating || shouldPassIndirectly(receiver) ? { indirect: true } : { indirect: false, receiver };
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

export class BoundValueMethod {
  private readonly fn: SwiftNativeFunction;
  private readonly indirectSelf: boolean;

  constructor(
    readonly resolved: ResolvedMethod,
    private readonly receiver: Metadata,
    private readonly self: NativePointer,
    mutating: boolean
  ) {
    this.indirectSelf = valueSelfRouting(receiver, mutating).indirect;
    this.fn = valueInvoker(resolved, receiver, this.indirectSelf);
  }

  get address(): NativePointer {
    return this.resolved.address;
  }

  call(...args: CallArg[]): CallResult {
    const { argTypes, returnType } = this.resolved;
    if (args.length !== argTypes.length) {
      throw new Error(`${this.resolved.selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    return callBorrowingArgs(argTypes, args, returnType, (argPtrs) =>
      this.indirectSelf ? this.fn(this.self, ...argPtrs) : this.fn(...argPtrs, this.self)
    );
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

type ArgPlan =
  | { kind: "generic"; index: number; metadata: Metadata }
  | { kind: "concrete"; metadata: Metadata }
  | { kind: "abstractIndirect"; metadata: Metadata };

function planGenericType(name: string, genericParams: string[], typeArguments: Metadata[]): ArgPlan {
  const index = genericParams.indexOf(name);
  if (index !== -1) {
    const metadata = typeArguments[index];
    if (metadata === undefined) {
      throw new Error(`missing type argument for generic parameter ${name}`);
    }
    return { kind: "generic", index, metadata };
  }
  const concrete = resolveType(name);
  if (concrete !== null) {
    return { kind: "concrete", metadata: concrete };
  }
  return planCompoundType(name, genericParams, typeArguments);
}

function planCompoundType(expr: string, genericParams: string[], typeArguments: Metadata[]): ArgPlan {
  const metadata = resolveTypeExpr(expr, (name) => {
    const i = genericParams.indexOf(name);
    return i === -1 ? null : typeArguments[i] ?? null;
  });
  if (metadata === null) {
    throw new Error(`cannot resolve generic signature type ${expr}`);
  }
  return compoundIsAddressOnly(expr, genericParams)
    ? { kind: "abstractIndirect", metadata }
    : { kind: "concrete", metadata };
}

// Accepts the demangler's desugared spelling (Swift.Array<A>) and the sugared one ([A]). Array/Set/
// Dictionary are a fixed-layout buffer (direct); Optional<param> embeds the abstract param (indirect).
function compoundIsAddressOnly(expr: string, genericParams: string[]): boolean {
  const t = expr.trim();
  if (t.endsWith("?") || t.endsWith("!")) {
    return optionalIsAddressOnly(t.slice(0, -1), genericParams, expr);
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    return false;
  }
  const lt = t.indexOf("<");
  if (lt !== -1 && t.endsWith(">")) {
    const base = t.slice(0, lt);
    if (base === "Swift.Array" || base === "Swift.Dictionary" || base === "Swift.Set") {
      return false;
    }
    if (base === "Swift.Optional") {
      return optionalIsAddressOnly(t.slice(lt + 1, -1), genericParams, expr);
    }
  }
  throw new Error(`unsupported compound generic signature type ${expr} (only [T], [K: V] and T? are supported)`);
}

function optionalIsAddressOnly(payload: string, genericParams: string[], expr: string): boolean {
  if (genericParams.includes(payload.trim())) {
    return true;
  }
  throw new Error(`unsupported compound generic signature type ${expr} (Optional payload must be a generic parameter)`);
}

function swiftArgType(plan: ArgPlan): SwiftArgType {
  switch (plan.kind) {
    case "generic":
      return { genericParam: plan.index };
    case "concrete":
      return plan.metadata;
    case "abstractIndirect":
      return { metadata: plan.metadata, addressOnly: true };
  }
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

interface GenericMethodPlan {
  address: NativePointer;
  selector: string;
  argPlans: ArgPlan[];
  returnPlan: ArgPlan | null;
  throws: boolean;
  typeArguments: Metadata[];
  witnessTables: NativePointer[];
}

// Type-metadata + witness pointers trail the formal args, so a trailing-exploded value self lands
// before them; indirect self rides in x20 (hasSelf).
export class GenericBoundMethod {
  private readonly fn: SwiftNativeFunction;
  private readonly indirectSelf: boolean;
  readonly address: NativePointer;
  readonly selector: string;

  constructor(
    private readonly plan: GenericMethodPlan,
    private readonly self: NativePointer,
    routing: SelfRouting
  ) {
    this.address = plan.address;
    this.selector = plan.selector;
    this.indirectSelf = routing.indirect;
    const returnType = plan.returnPlan === null ? null : swiftArgType(plan.returnPlan);
    const argTypes = plan.argPlans.map(swiftArgType);
    const opts = { throws: plan.throws, typeArguments: plan.typeArguments, witnessTables: plan.witnessTables };
    this.fn = routing.indirect
      ? makeSwiftNativeFunction(plan.address, returnType, argTypes, { hasSelf: true, ...opts })
      : makeSwiftNativeFunction(plan.address, returnType, [...argTypes, routing.receiver], opts);
  }

  call(...args: CallArg[]): CallResult {
    if (args.length !== this.plan.argPlans.length) {
      throw new Error(`${this.selector} expects ${this.plan.argPlans.length} argument(s), got ${args.length}`);
    }
    const argTypes = this.plan.argPlans.map((p) => p.metadata);
    return callBorrowingArgs(argTypes, args, this.plan.returnPlan?.metadata ?? null, (argPtrs) =>
      this.indirectSelf ? this.fn(this.self, ...argPtrs) : this.fn(...argPtrs, this.self)
    );
  }
}

function planGenericMethod(typeNameArg: string, methodName: string, options: MethodResolveOptions): GenericMethodPlan {
  const fullName = canonicalTypeName(typeNameArg);
  const typeArguments = options.typeArguments ?? [];
  const candidates = applyOverloadFilters(
    typeMembers(fullName).methods.filter(
      (c) => c.name === methodName && c.signature.genericParams.length > 0 && c.signature.simpleGenerics
    ),
    options
  );
  if (candidates.length === 0) {
    throw new Error(`no generic method ${methodName} on ${fullName}`);
  }
  if (candidates.length > 1) {
    const selectors = candidates.map((c) => c.signature.selector).join(", ");
    throw new Error(`ambiguous generic method ${methodName} on ${fullName}: ${selectors} (disambiguate with { arity } or { labels })`);
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
  return { address, selector: signature.selector, argPlans, returnPlan, throws: signature.throws, typeArguments, witnessTables };
}

export function bindGenericMethod(
  typeName: string,
  methodName: string,
  self: NativePointer,
  options: MethodResolveOptions = {}
): GenericBoundMethod {
  return new GenericBoundMethod(planGenericMethod(typeName, methodName, options), self, { indirect: true });
}

export function bindGenericValueMethod(
  receiver: Metadata,
  self: NativePointer,
  methodName: string,
  options: ValueMethodResolveOptions = {}
): GenericBoundMethod {
  const plan = planGenericMethod(typeName(receiver), methodName, options);
  return new GenericBoundMethod(plan, self, valueSelfRouting(receiver, options.mutating === true));
}

// A bare type parameter (T) is address-only in the generic context but concretely sized by the
// instance's type argument; concrete and compound types lower as elsewhere.
function planTypeMemberArg(name: string, typeParams: string[], typeArguments: Metadata[]): ArgPlan {
  const index = typeParams.indexOf(name.trim());
  if (index !== -1) {
    return { kind: "abstractIndirect", metadata: typeArguments[index] };
  }
  const concrete = resolveType(name);
  if (concrete !== null) {
    return { kind: "concrete", metadata: concrete };
  }
  return planCompoundType(name, typeParams, typeArguments);
}

// The enclosing generic type's concrete arguments, recovered from the instance's bound type name
// ("Foo<Swift.Int>" → Int) so it works for both value and class metadata. Parameters are named A,
// B... by declaration order to match the demangled signatures.
function genericTypeArguments(receiver: Metadata): { unboundName: string; typeParams: string[]; typeArguments: Metadata[] } {
  const { base, arguments: argNames } = splitBoundTypeName(typeName(receiver));
  const typeArguments = argNames.map((n) => {
    const metadata = resolveTypeExpr(n, () => null);
    if (metadata === null) {
      throw new Error(`cannot resolve type argument ${n} of ${base}`);
    }
    return metadata;
  });
  return { unboundName: base, typeParams: typeArguments.map((_, i) => String.fromCharCode(65 + i)), typeArguments };
}

// Methods on a generic type, no method-level generics. self is always indirect (class: object in
// x20; value: its bytes, address-only in the generic context). A value type trails its Self metadata
// — the callee reads T's metadata + witnesses from that vector; a class recovers them from the isa.
function planGenericTypeMethod(receiver: Metadata, methodName: string, options: MethodResolveOptions, trailsSelfMetadata: boolean): GenericMethodPlan {
  const { unboundName, typeParams, typeArguments } = genericTypeArguments(receiver);
  const candidates = applyOverloadFilters(
    typeMembers(unboundName).methods.filter(
      (c) => c.name === methodName && c.signature.genericParams.length === 0 && c.signature.simpleGenerics
    ),
    options
  );
  if (candidates.length === 0) {
    throw new Error(`no method ${methodName} on ${unboundName}`);
  }
  if (candidates.length > 1) {
    const overloads = candidates.map((c) => c.signature.selector).join(", ");
    throw new Error(`ambiguous method ${methodName} on ${unboundName}: ${overloads} (disambiguate with { arity }, { labels }, or { argTypes })`);
  }
  const { address, signature } = candidates[0];
  const argPlans = signature.argTypeNames.map((n) => planTypeMemberArg(n, typeParams, typeArguments));
  const returnPlan =
    signature.returnTypeName === null ? null : planTypeMemberArg(signature.returnTypeName, typeParams, typeArguments);
  return {
    address,
    selector: signature.selector,
    argPlans,
    returnPlan,
    throws: signature.throws,
    typeArguments: trailsSelfMetadata ? [receiver] : [],
    witnessTables: [],
  };
}

export function bindGenericTypeValueMethod(
  receiver: Metadata,
  self: NativePointer,
  methodName: string,
  options: MethodResolveOptions = {}
): GenericBoundMethod {
  return new GenericBoundMethod(planGenericTypeMethod(receiver, methodName, options, true), self, { indirect: true });
}

export function bindGenericTypeClassMethod(
  receiver: Metadata,
  self: NativePointer,
  methodName: string,
  options: MethodResolveOptions = {}
): GenericBoundMethod {
  return new GenericBoundMethod(planGenericTypeMethod(receiver, methodName, options, false), self, { indirect: true });
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

export function getProperty(self: NativePointer, typeName: string, member: string): CallResult {
  const accessor = resolveAccessor(typeName, member, "getter");
  return decodeReturn(accessor.type, invokerForAccessor(accessor)(self));
}

// Setter newValue is +1/owned: the callee consumes the temp, so it is not destroyed here.
export function setProperty(self: NativePointer, typeName: string, member: string, value: CallArg): void {
  const accessor = resolveAccessor(typeName, member, "setter");
  invokerForAccessor(accessor)(self, marshalArg(accessor.type, value));
}
