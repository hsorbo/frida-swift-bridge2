import { Metadata, MetadataKind, getMetadata } from "../abi/metadata.js";
import { ContextDescriptor, ContextDescriptorKind } from "../abi/context-descriptor.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { ClassInstance } from "../abi/heap-object.js";
import { createObject, SwiftObject, RAW } from "./object-facade.js";
import { ValueInstance } from "../abi/value.js";
import { readValue, writeValue, embedsManagedReference, SwiftValue } from "../abi/instance.js";
import { findType } from "../reflection/registry.js";
import { demangle } from "./demangle.js";
import {
  parseSwiftSignature,
  parseFunctionTypeSpelling,
  FunctionTypeSpelling,
  voidMetadata,
  resolveType,
  resolveTypeExpr,
  splitBoundTypeName,
  SwiftFunctionSignature,
  SwiftAccessorSignature,
} from "./symbolication.js";
import {
  makeSwiftNativeFunction,
  SwiftNativeFunction,
  SwiftArgType,
  shouldPassIndirectly,
} from "./calling-convention.js";
import { SwiftClosure, ClosureSpec, ClosureBody, LoadableClosureBody, SwiftThrow } from "./closure.js";
import { typeName } from "./type-name.js";
import { readString, createString } from "../abi/string.js";
import {
  findProtocol,
  conformsToProtocol,
  conformingTypes,
  ProtocolConformance,
} from "../abi/protocol-conformance.js";
import { ProtocolRequirement, ProtocolRequirementKind, readProtocolRequirements } from "../abi/protocol-descriptor.js";
import { WitnessTable } from "../abi/witness-table.js";
import type { SwiftType } from "./swift-type.js";

export type MethodKind = "method" | "init";

export type CallResult = SwiftValue | SwiftObject;

export function isSwiftObject(value: CallResult): value is SwiftObject {
  return typeof value === "object" && value !== null && "$kind" in value;
}

// A JS value, a ValueInstance (byte-copied in, e.g. an Array), a facade (unwrapped in marshalArg),
// or a closure request marshalled into a function-typed generic parameter.
export type CallArg = SwiftValue | ValueInstance | SwiftObject | ClosureSpec;

export interface RawInstance {
  readonly handle: NativePointer;
  readonly owned: boolean;
  readonly kind: "object" | "value";
  readonly type: SwiftType;
  get(name: string): CallResult;
  set(name: string, value: CallArg): void;
  call(name: string, ...args: CallArg[]): CallResult;
  field(name: string): ValueInstance;
  dispose(): void;
  [Symbol.dispose](): void;
}

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
  isStatic: boolean;
}

interface TypeMembers {
  methods: MethodCandidate[];
  accessors: AccessorCandidate[];
}

const tableCache = new Map<string, TypeMembers>();
const invokerCache = new Map<string, SwiftNativeFunction>();

function rawArg(value: CallArg): CallArg | ClassInstance {
  return value !== null && typeof value === "object"
    ? (value as { [RAW]?: ClassInstance | ValueInstance })[RAW] ?? value
    : value;
}

function marshalArg(metadata: Metadata, value: CallArg): NativePointer {
  const arg = rawArg(value);
  const buffer = Memory.alloc(metadata.typeLayout.stride);
  if (arg instanceof ValueInstance) {
    if (!arg.metadata.handle.equals(metadata.handle)) {
      throw new Error(`argument is a ${typeName(arg.metadata)} value, expected ${typeName(metadata)}`);
    }
    arg.copyInto(buffer);
  } else if (arg instanceof ClassInstance) {
    buffer.writePointer(arg.handle);
  } else if (metadata.kind === MetadataKind.Class) {
    buffer.writePointer(arg as NativePointer);
  } else {
    writeValue(metadata, buffer, arg as SwiftValue);
  }
  return buffer;
}

// Returns are +1: adopt a class; destroy a read non-POD temp; POD owns nothing. A value embedding a
// managed reference would dangle on that destroy, so hand it back as an owned ValueInstance instead.
function decodeReturn(returnType: Metadata | null, ret: NativePointer | null): CallResult {
  if (returnType === null || ret === null) {
    return null;
  }
  if (returnType.kind === MetadataKind.Class) {
    return createObject(ClassInstance.adopt(ret.readPointer()));
  }
  if (!returnType.valueWitnesses.isPOD && embedsManagedReference(returnType)) {
    return createObject(ValueInstance.adopt(returnType, ret));
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
  const seen = new Set<string>();
  // initsOnly restricts the symbol-table pass to initializers: value-type inits are omitted from the
  // export trie in non-library-evolution builds, but regular non-exported methods stay reachable only
  // via the vtable, not the symbol route. The export trie carries everything else.
  const consider = (name: string, address: NativePointer, initsOnly: boolean): void => {
    if (address.isNull() || seen.has(address.toString())) {
      return;
    }
    seen.add(address.toString());
    const demangled = demangle(name);
    if (demangled === null) {
      return;
    }
    const signature = parseSwiftSignature(demangled);
    if (signature === null) {
      return;
    }
    if (signature.kind === "function") {
      if (initsOnly && signature.name !== "init") {
        return;
      }
      const { context, isStatic } = stripReceiverKeyword(signature.context);
      if (context === fullName) {
        methods.push({ address, name: signature.name, isStatic, signature });
      }
    } else if (!initsOnly && signature.kind !== "modify") {
      const { context, isStatic } = stripReceiverKeyword(signature.context);
      if (context === fullName) {
        accessors.push({ address, member: signature.member, kind: signature.kind, typeName: signature.typeName, isStatic });
      }
    }
  };
  for (const e of module.enumerateExports()) {
    consider(e.name, e.address, false);
  }
  for (const s of module.enumerateSymbols()) {
    consider(s.name, s.address, true);
  }
  const members: TypeMembers = { methods, accessors };
  tableCache.set(fullName, members);
  return members;
}

export function enumerateMethods(typeName: string, ownOnly = false): MethodInfo[] {
  const seen = new Set<string>();
  const methods: MethodInfo[] = [];
  const fullName = canonicalTypeName(typeName);
  for (const className of ownOnly ? [fullName] : classChainNames(fullName)) {
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

export interface PropertyInfo {
  name: string;
  typeName: string;
  isStatic: boolean;
  writable: boolean;
}

// One entry per property: getter and setter symbols merge into a single writable flag. Walks the
// class chain like enumerateMethods so a subclass property shadows the superclass one of the same name.
export function enumerateProperties(typeName: string): PropertyInfo[] {
  const seen = new Set<string>();
  const properties: PropertyInfo[] = [];
  for (const className of classChainNames(canonicalTypeName(typeName))) {
    const atThisLevel = new Map<string, PropertyInfo>();
    for (const a of typeMembers(className).accessors) {
      const key = `${a.isStatic ? "s" : "i"}:${a.member}`;
      if (seen.has(key)) {
        continue;
      }
      let info = atThisLevel.get(key);
      if (info === undefined) {
        info = { name: a.member, typeName: a.typeName, isStatic: a.isStatic, writable: false };
        atThisLevel.set(key, info);
        properties.push(info);
      }
      if (a.kind === "setter") {
        info.writable = true;
      }
    }
    for (const key of atThisLevel.keys()) {
      seen.add(key);
    }
  }
  return properties;
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

// A value-type initializer is self-less: the @thin metatype self is erased, so it lowers like a
// static factory returning the type (the +1/owned return is adopted as a ValueInstance). Init params are
// +1/consumed — the callee owns the arg temps, so they are not destroyed here. Mirrors ClassType.init.
export class BoundValueInitializer {
  private readonly fn: SwiftNativeFunction;

  constructor(readonly resolved: ResolvedMethod) {
    this.fn = staticInvokerFor(resolved);
  }

  get address(): NativePointer {
    return this.resolved.address;
  }

  call(...args: CallArg[]): SwiftObject {
    const { argTypes, returnType, selector } = this.resolved;
    if (returnType === null) {
      throw new Error(`${selector} is not a value initializer`);
    }
    if (args.length !== argTypes.length) {
      throw new Error(`${selector} expects ${argTypes.length} argument(s), got ${args.length}`);
    }
    const ret = this.fn(...args.map((value, i) => marshalArg(argTypes[i], value)));
    if (ret === null) {
      throw new Error(`${selector} returned no value`);
    }
    return createObject(ValueInstance.adopt(returnType, ret));
  }
}

export function bindValueInitializer(
  receiver: Metadata,
  options: MethodResolveOptions = {}
): BoundValueInitializer {
  return new BoundValueInitializer(resolveMethod(typeName(receiver), "init", options));
}

type SelfRouting = { indirect: true } | { indirect: false; receiver: Metadata };

// Value-type self is indirect (x20) when mutating/inout or large/non-POD; else it rides as a trailing arg.
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

// buffer: (UnsafeRawBufferPointer) -> @out, via an asm trampoline. loadable: register params and
// result. loadableIndirect: register params, @out result (e.g. (Int) -> R).
type ClosureShape =
  | { mode: "buffer"; throws: boolean }
  | { mode: "loadable"; params: LoadableScalar[]; result: LoadableScalar | null; throws: boolean }
  | { mode: "loadableIndirect"; params: LoadableScalar[]; resultMetadata: Metadata; throws: boolean };

type ArgPlan =
  | { kind: "generic"; index: number; metadata: Metadata }
  | { kind: "concrete"; metadata: Metadata }
  | { kind: "abstractIndirect"; metadata: Metadata }
  | { kind: "closure"; shape: ClosureShape };

const RAW_BUFFER_PARAM = "Swift.UnsafeRawBufferPointer";

interface LoadableScalar {
  nativeType: NativeCallbackArgumentType;
  decode?: (raw: NativeCallbackArgumentValue) => unknown; // set only by non-scalar wire shapes (String)
  encode?: (value: unknown) => NativeCallbackReturnValue;
}

const STRING_WORDS: NativeCallbackArgumentType = ["pointer", "pointer"];

function decodeString(raw: NativeCallbackArgumentValue): string {
  const words = raw as NativePointer[];
  const buffer = Memory.alloc(Process.pointerSize * 2);
  buffer.writePointer(words[0]);
  buffer.add(Process.pointerSize).writePointer(words[1]);
  return readString(buffer) ?? "";
}

// createString's +1 rides the words to Swift, which owns the closure result.
function encodeString(value: unknown): NativePointer[] {
  const s = createString(value as string);
  return [s.readPointer(), s.add(Process.pointerSize).readPointer()];
}

// Scalar types passable through a loadable closure, with the native type Frida marshals them as.
const LOADABLE_SCALARS: Record<string, LoadableScalar> = {
  "Swift.Int": { nativeType: "int64" },
  "Swift.UInt": { nativeType: "uint64" },
  "Swift.Bool": { nativeType: "bool" },
  "Swift.Double": { nativeType: "double" },
  "Swift.Float": { nativeType: "float" },
  "Swift.Int8": { nativeType: "int8" },
  "Swift.Int16": { nativeType: "int16" },
  "Swift.Int32": { nativeType: "int32" },
  "Swift.Int64": { nativeType: "int64" },
  "Swift.UInt8": { nativeType: "uint8" },
  "Swift.UInt16": { nativeType: "uint16" },
  "Swift.UInt32": { nativeType: "uint32" },
  "Swift.UInt64": { nativeType: "uint64" },
  "Swift.UnsafeRawPointer": { nativeType: "pointer" },
  "Swift.UnsafeMutableRawPointer": { nativeType: "pointer" },
  "Swift.String": { nativeType: STRING_WORDS, decode: decodeString, encode: encodeString },
};

function closurePlan(shape: ClosureShape): ArgPlan {
  return { kind: "closure", shape };
}

function planClosureType(spelling: FunctionTypeSpelling, genericParams: string[], typeArguments: Metadata[]): ArgPlan {
  const result = spelling.result.trim();
  const resultIsGeneric = genericParams.includes(result);
  const resultIsVoid = result === "()" || result === "Swift.Void";
  const takesBuffer = spelling.params.length === 1 && spelling.params[0].trim() === RAW_BUFFER_PARAM;
  if ((spelling.params.length === 0 || takesBuffer) && (resultIsVoid || resultIsGeneric)) {
    return closurePlan({ mode: "buffer", throws: spelling.throws });
  }

  const params = spelling.params.map((p) => LOADABLE_SCALARS[p.trim()] ?? null);
  if (params.every((p) => p !== null)) {
    const scalars = params as LoadableScalar[];
    if (resultIsGeneric) {
      const resultMetadata = typeArguments[genericParams.indexOf(result)];
      if (resultMetadata === undefined) {
        throw new Error(`missing type argument for closure result ${result}`);
      }
      return closurePlan({
        mode: "loadableIndirect",
        params: scalars,
        resultMetadata,
        throws: spelling.throws,
      });
    }
    const resultScalar = resultIsVoid ? null : LOADABLE_SCALARS[result] ?? null;
    if (resultIsVoid || resultScalar !== null) {
      return closurePlan({
        mode: "loadable",
        params: scalars,
        result: resultScalar,
        throws: spelling.throws,
      });
    }
  }

  throw new Error(
    `unsupported closure type (${spelling.params.join(", ")}) -> ${result}; supported: () or (${RAW_BUFFER_PARAM}) returning Void or a generic, or loadable scalars (${Object.keys(LOADABLE_SCALARS).join(", ")}) returning a scalar, Void, or a generic`
  );
}

function planGenericType(name: string, genericParams: string[], typeArguments: Metadata[]): ArgPlan {
  const fn = parseFunctionTypeSpelling(name);
  if (fn !== null) {
    return planClosureType(fn, genericParams, typeArguments);
  }
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
    case "closure":
      return { closure: true };
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
    const plans = this.plan.argPlans;
    if (args.length !== plans.length) {
      throw new Error(`${this.selector} expects ${plans.length} argument(s), got ${args.length}`);
    }
    const closures: SwiftClosure[] = []; // in scope through the call: Swift invokes them in-flight
    const argPtrs: NativePointer[] = [];
    const borrowed: { metadata: Metadata; ptr: NativePointer }[] = [];
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (plan.kind === "closure") {
        const closure = marshalClosure(plan, args[i]);
        closures.push(closure);
        argPtrs.push(closure.value());
        continue;
      }
      const ptr = marshalArg(plan.metadata, args[i]);
      argPtrs.push(ptr);
      if (plan.metadata.kind !== MetadataKind.Class && !plan.metadata.valueWitnesses.isPOD) {
        borrowed.push({ metadata: plan.metadata, ptr });
      }
    }
    const returnType = this.plan.returnPlan === null ? null : planMetadata(this.plan.returnPlan);
    try {
      const ret = this.indirectSelf ? this.fn(this.self, ...argPtrs) : this.fn(...argPtrs, this.self);
      return decodeReturn(returnType, ret);
    } finally {
      for (const b of borrowed) {
        b.metadata.valueWitnesses.destroy(b.ptr);
      }
    }
  }
}

function planMetadata(plan: ArgPlan): Metadata {
  if (plan.kind === "closure") {
    throw new Error("closure types are only supported as arguments");
  }
  return plan.metadata;
}

function loadableNativeTypes(params: LoadableScalar[]): NativeCallbackArgumentType[] {
  return params.map((p) => p.nativeType);
}

function decodeArgs(raw: NativeCallbackArgumentValue[], params: LoadableScalar[]): unknown[] {
  return raw.map((value, i) => (params[i].decode ? params[i].decode!(value) : value));
}

function marshalClosure(plan: { shape: ClosureShape }, arg: CallArg): SwiftClosure {
  if (!(arg instanceof ClosureSpec)) {
    throw new Error("expected a Swift.closure() argument for a function-typed parameter");
  }
  const shape = plan.shape;
  if (shape.mode === "loadable") {
    const userBody = arg.body;
    const encode = shape.result?.encode;
    const body: LoadableClosureBody = (...raw) => {
      const r = userBody(...decodeArgs(raw as NativeCallbackArgumentValue[], shape.params));
      return r instanceof SwiftThrow || encode === undefined ? r : (encode(r) as never);
    };
    return SwiftClosure.loadable(body, loadableNativeTypes(shape.params), shape.result?.nativeType ?? "void", {
      throws: shape.throws,
    });
  }
  if (shape.mode === "loadableIndirect") {
    const userBody = arg.body;
    const resultMetadata = shape.resultMetadata;
    return SwiftClosure.loadableProducing(
      (raw, result) => {
        const r = userBody(...decodeArgs(raw as NativeCallbackArgumentValue[], shape.params));
        if (r instanceof SwiftThrow) {
          return r;
        }
        writeValue(resultMetadata, result, r);
      },
      loadableNativeTypes(shape.params),
      { throws: shape.throws }
    );
  }
  const userBody = arg.body;
  const body: ClosureBody = (buffer, result) => {
    const r = userBody(buffer, result);
    return r instanceof SwiftThrow ? r.error : (r as NativePointer | void);
  };
  return SwiftClosure.overBytes(body, { throws: shape.throws });
}

function inferClosureTypeArguments(signature: SwiftFunctionSignature): Metadata[] {
  const closureResultParams = new Set<string>();
  for (const argName of signature.argTypeNames) {
    const fn = parseFunctionTypeSpelling(argName);
    if (fn !== null && signature.genericParams.includes(fn.result.trim())) {
      closureResultParams.add(fn.result.trim());
    }
  }
  return signature.genericParams.map((param) => {
    if (!closureResultParams.has(param)) {
      throw new Error(`cannot infer type argument ${param} of ${signature.selector}; supply it via { typeArguments }`);
    }
    return voidMetadata(); // value-less JS closure ⇒ Void result
  });
}

// planGenericMethod also binds a non-generic method whose closure parameter needs ArgPlan lowering.
function argPlanBound(signature: SwiftFunctionSignature): boolean {
  return signature.genericParams.length > 0
    ? signature.simpleGenerics
    : signature.argTypeNames.some((n) => parseFunctionTypeSpelling(n) !== null);
}

function planGenericMethod(typeNameArg: string, methodName: string, options: MethodResolveOptions): GenericMethodPlan {
  const fullName = canonicalTypeName(typeNameArg);
  const typeArguments = options.typeArguments ?? [];
  const candidates = applyOverloadFilters(
    typeMembers(fullName).methods.filter((c) => c.name === methodName && argPlanBound(c.signature)),
    options
  );
  if (candidates.length === 0) {
    throw new Error(`no generic or closure-taking method ${methodName} on ${fullName}`);
  }
  if (candidates.length > 1) {
    const selectors = candidates.map((c) => c.signature.selector).join(", ");
    throw new Error(`ambiguous generic method ${methodName} on ${fullName}: ${selectors} (disambiguate with { arity } or { labels })`);
  }
  const { address, signature } = candidates[0];
  const resolvedTypeArguments =
    typeArguments.length === 0 && signature.genericParams.length > 0
      ? inferClosureTypeArguments(signature)
      : typeArguments;
  if (resolvedTypeArguments.length !== signature.genericParams.length) {
    throw new Error(`${signature.selector} needs ${signature.genericParams.length} type argument(s), got ${typeArguments.length}`);
  }
  const argPlans = signature.argTypeNames.map((n) => planGenericType(n, signature.genericParams, resolvedTypeArguments));
  const returnPlan =
    signature.returnTypeName === null
      ? null
      : planGenericType(signature.returnTypeName, signature.genericParams, resolvedTypeArguments);
  const witnessTables = options.witnessTables ?? autoWitnessTables(signature, resolvedTypeArguments);
  return { address, selector: signature.selector, argPlans, returnPlan, throws: signature.throws, typeArguments: resolvedTypeArguments, witnessTables };
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

function protocolOf(table: WitnessTable): ContextDescriptor {
  const protocol = new ProtocolConformance(table.conformanceDescriptor).protocol;
  if (protocol === null) {
    throw new Error("witness table's conformance descriptor has no protocol");
  }
  return protocol;
}

function stripWitnessWrapper(demangled: string): string | null {
  const prefix = "protocol witness for ";
  if (!demangled.startsWith(prefix)) {
    return null;
  }
  const rest = demangled.slice(prefix.length);
  const at = rest.indexOf(" in conformance ");
  return at === -1 ? rest : rest.slice(0, at);
}

const symbolsByModule = new Map<string, Map<string, string>>();

// Witness thunks are usually private linkage, invisible to symbolicate()'s exports-only lookup.
function symbolicateLocal(address: NativePointer): string | null {
  const module = Process.findModuleByAddress(address);
  if (module === null) {
    return null;
  }
  let names = symbolsByModule.get(module.path);
  if (names === undefined) {
    names = new Map<string, string>();
    for (const s of module.enumerateSymbols()) {
      names.set(s.address.toString(), s.name);
    }
    symbolsByModule.set(module.path, names);
  }
  const name = names.get(address.toString());
  return name === undefined ? null : demangle(name);
}

const CALLABLE_REQUIREMENT_KINDS = new Set<ProtocolRequirementKind>([
  ProtocolRequirementKind.Method,
  ProtocolRequirementKind.Init,
  ProtocolRequirementKind.Getter,
  ProtocolRequirementKind.Setter,
]);

export interface NamedRequirement {
  requirement: ProtocolRequirement;
  name: string; // bare name — round-trips into WitnessTable.method()/get()/set()
  signature: SwiftFunctionSignature | SwiftAccessorSignature;
}

const namedRequirementsByProtocol = new Map<string, NamedRequirement[]>();

// A requirement's witnessIndex is protocol-global: every conformance lays its witness table out in
// the same requirement order, so a name recovered from one conformance's thunk is valid to attach
// to any other conformance's table at the same index. Scanning every conforming type (rather than
// requiring one caller-supplied table) both gives reflection a name with no invocation in hand and
// lets a stripped conformance's own unrecoverable thunk still resolve by name via a sibling.
export function namedProtocolRequirements(protocol: ContextDescriptor): NamedRequirement[] {
  const key = protocol.handle.toString();
  const cached = namedRequirementsByProtocol.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const pending = readProtocolRequirements(protocol).filter(
    (r) => !r.isAsync && CALLABLE_REQUIREMENT_KINDS.has(r.kind)
  );
  const found = new Map<number, NamedRequirement>();

  for (const typeDescriptor of pending.length > 0 ? conformingTypes(protocol) : []) {
    if (found.size === pending.length) {
      break;
    }
    if (typeDescriptor.isGeneric) {
      continue; // no accessFunction to call without type arguments — never nameable this way
    }
    let type: Metadata;
    try {
      type = getMetadata(typeDescriptor);
    } catch {
      continue;
    }
    const tableAddr = conformsToProtocol(type, protocol);
    if (tableAddr === null) {
      continue;
    }
    const table = new WitnessTable(tableAddr, type);
    for (const requirement of pending) {
      if (found.has(requirement.witnessIndex)) {
        continue;
      }
      const demangled = symbolicateLocal(table.requirement(requirement.witnessIndex));
      if (demangled === null) {
        continue;
      }
      const stripped = stripWitnessWrapper(demangled);
      if (stripped === null) {
        continue;
      }
      const signature = parseSwiftSignature(stripped);
      if (signature === null) {
        continue;
      }
      const name = signature.kind === "function" ? signature.name : signature.member;
      found.set(requirement.witnessIndex, { requirement, name, signature });
    }
  }

  const result = [...found.values()];
  namedRequirementsByProtocol.set(key, result);
  return result;
}

function witnessCandidates(table: WitnessTable): NamedRequirement[] {
  return namedProtocolRequirements(protocolOf(table));
}

export function resolveWitnessMethod(table: WitnessTable, methodName: string): ResolvedMethod {
  const protocolName = protocolOf(table).fullTypeName ?? "protocol";
  const matches = witnessCandidates(table).filter(
    (c): c is NamedRequirement & { signature: SwiftFunctionSignature } =>
      c.signature.kind === "function" && c.signature.name === methodName
  );
  if (matches.length === 0) {
    throw new Error(`no requirement ${methodName} on ${protocolName}`);
  }
  if (matches.length > 1) {
    const overloads = matches.map((m) => m.signature.selector).join(", ");
    throw new Error(`ambiguous requirement ${methodName} on ${protocolName}: ${overloads}`);
  }
  const { requirement, signature } = matches[0];
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
  return {
    address: table.requirement(requirement.witnessIndex),
    argTypes,
    returnType,
    throws: signature.throws,
    isStatic: !requirement.isInstance,
    selector: signature.selector,
  };
}

export function bindWitnessMethod(table: WitnessTable, self: NativePointer, methodName: string): BoundMethod {
  return new BoundMethod(resolveWitnessMethod(table, methodName), self);
}

export interface WitnessMethodSignature {
  argTypes: Metadata[];
  returnType: Metadata | null;
  throws?: boolean;
}

export function bindWitnessMethodAt(
  table: WitnessTable,
  witnessIndex: number,
  self: NativePointer,
  signature: WitnessMethodSignature
): BoundMethod {
  const resolved: ResolvedMethod = {
    address: table.requirement(witnessIndex),
    argTypes: signature.argTypes,
    returnType: signature.returnType,
    throws: signature.throws ?? false,
    isStatic: false,
    selector: `#${witnessIndex}`,
  };
  return new BoundMethod(resolved, self);
}

interface ResolvedWitnessAccessor {
  address: NativePointer;
  type: Metadata;
  kind: AccessorKind;
}

function resolveWitnessAccessor(table: WitnessTable, member: string, kind: AccessorKind): ResolvedWitnessAccessor {
  const match = witnessCandidates(table).find(
    (c): c is NamedRequirement & { signature: SwiftAccessorSignature } =>
      c.signature.kind === kind && c.signature.member === member
  );
  if (match === undefined) {
    throw new Error(`no ${kind} for ${member} on ${protocolOf(table).fullTypeName ?? "protocol"}`);
  }
  const type = resolveType(match.signature.typeName);
  if (type === null) {
    throw new Error(`cannot resolve ${kind} type ${match.signature.typeName} of ${member}`);
  }
  return { address: table.requirement(match.requirement.witnessIndex), type, kind };
}

function invokerForWitnessAccessor(accessor: ResolvedWitnessAccessor): SwiftNativeFunction {
  const key = `witness:${accessor.address}`;
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

export function witnessGetProperty(table: WitnessTable, self: NativePointer, name: string): CallResult {
  const accessor = resolveWitnessAccessor(table, name, "getter");
  return decodeReturn(accessor.type, invokerForWitnessAccessor(accessor)(self));
}

export function witnessSetProperty(table: WitnessTable, self: NativePointer, name: string, value: CallArg): void {
  const accessor = resolveWitnessAccessor(table, name, "setter");
  invokerForWitnessAccessor(accessor)(self, marshalArg(accessor.type, value));
}

const DIRECT_BRANCH_MNEMONICS: Partial<Record<Architecture, ReadonlySet<string>>> = {
  arm64: new Set(["b", "bl"]),
  x64: new Set(["call", "jmp"]),
};

const CONTROL_FLOW_GROUPS = new Set(["jump", "call", "ret"]);

// A witness thunk is a prologue then one direct branch; anything else has no fixed target.
function followDirectBranch(address: NativePointer, maxInstructions = 8): NativePointer | null {
  const directMnemonics = DIRECT_BRANCH_MNEMONICS[Process.arch];
  if (directMnemonics === undefined) {
    return null;
  }
  let cursor = address;
  for (let i = 0; i < maxInstructions; i++) {
    const insn = Instruction.parse(cursor);
    if (insn.groups.some((g) => CONTROL_FLOW_GROUPS.has(g))) {
      if (!directMnemonics.has(insn.mnemonic)) {
        return null;
      }
      const operand = (insn as Arm64Instruction | X86Instruction).operands[0];
      return operand !== undefined && operand.type === "imm" ? ptr(operand.value.toString()) : null;
    }
    cursor = insn.next;
  }
  return null;
}

export type WitnessOrigin =
  | { kind: "default"; symbol: string }
  | { kind: "override"; symbol: string }
  | { kind: "unknown" };

const EXTENSION_PREFIX = /^\(extension in [^)]*\):/;

export function classifyWitnessOrigin(table: WitnessTable, requirement: ProtocolRequirement): WitnessOrigin {
  if (requirement.isAsync || !CALLABLE_REQUIREMENT_KINDS.has(requirement.kind)) {
    return { kind: "unknown" };
  }
  const target = followDirectBranch(table.requirement(requirement.witnessIndex));
  if (target === null) {
    return { kind: "unknown" };
  }
  const demangled = symbolicateLocal(target);
  if (demangled === null) {
    return { kind: "unknown" };
  }
  const unwrapped = demangled.replace(EXTENSION_PREFIX, "");
  const protocolName = protocolOf(table).fullTypeName;
  return unwrapped.startsWith(`${protocolName}.`)
    ? { kind: "default", symbol: demangled }
    : { kind: "override", symbol: demangled };
}
