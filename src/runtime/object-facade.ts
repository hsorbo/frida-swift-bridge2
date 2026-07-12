import { ClassInstance } from "../abi/heap-object.js";
import { ValueInstance } from "../abi/value.js";
import { Metadata } from "../abi/metadata.js";
import { SwiftValue } from "../abi/instance.js";
import {
  BoundMethod,
  BoundValueMethod,
  BoundAsyncMethod,
  GenericBoundMethod,
  GenericBoundAsyncMethod,
  CallResult,
  CallArg,
  MethodResolveOptions,
  ValueMethodResolveOptions,
  enumerateMethods,
  enumerateProperties,
} from "./method.js";
import { typeName } from "./type-name.js";
import { SwiftType } from "./swift-type.js";
import { ClosureSpec } from "./closure.js";

const RESERVED = new Set([
  "toString",
  "valueOf",
  "toJSON",
  "equals",
  "hasOwnProperty",
  "$kind",
  "$type",
  "$handle",
  "$className",
  "$fields",
  "$owned",
  "$call",
  "$method",
  "$get",
  "$set",
  "$field",
  "$container",
  "$vtable",
  "$vtableMethod",
  "$retain",
  "$release",
  "$dispose",
]);

// A synthesized `then` would make the facade thenable and silently break `await`; never a member.
const POISON = new Set(["then", "catch", "finally"]);

export const RAW: unique symbol = Symbol("swift.raw");

export interface SwiftObject {
  readonly $kind: "object" | "value";
  readonly $type: SwiftType;
  readonly $handle: NativePointer;
  readonly $className: string;
  readonly $fields: { [name: string]: SwiftValue } | SwiftValue;
  readonly $owned: boolean;
  $call(name: string, ...args: CallArg[]): CallResult | Promise<CallResult>;
  $method(name: string, options?: MethodResolveOptions): BoundMethod | BoundValueMethod | GenericBoundMethod | GenericBoundAsyncMethod | BoundAsyncMethod;
  $get(name: string): CallResult;
  $set(name: string, value: CallArg): void;
  $field(name: string): ValueInstance;
  $container(): SwiftValue;
  $retain(): SwiftObject;
  $release(): void;
  $dispose(): void;
  equals(other: SwiftObject | ClassInstance | ValueInstance | NativePointer): boolean;
  toString(): string;
  [Symbol.dispose](): void;
  [key: string]: any;
}

function handleOf(other: SwiftObject | ClassInstance | ValueInstance | NativePointer): NativePointer {
  if (other instanceof NativePointer) return other;
  // A facade is `instanceof ClassInstance/ValueInstance` (proxy prototype), so unwrap it first.
  const raw = (other as { [RAW]?: ClassInstance | ValueInstance })[RAW] ?? other;
  return raw.handle;
}

interface MemberIndex {
  methods: Set<string>;
  properties: Set<string>;
}

// One facade for class and value alike; $kind discriminates. The proxy roots its target, so an
// owned target's +1 releases only when the proxy is GC'd.
export function createObject(source: NativePointer | ClassInstance | ValueInstance): SwiftObject {
  const target =
    source instanceof ClassInstance || source instanceof ValueInstance
      ? source
      : new ClassInstance(source);
  const isValue = target instanceof ValueInstance;
  const value = target as ValueInstance;
  const object = target as ClassInstance;

  const handle = (): NativePointer => target.handle;
  const dynamicType = (): Metadata => (isValue ? value.metadata : object.dynamicType);
  const fullName = (): string =>
    (isValue ? value.metadata : object.metadata).description.fullTypeName ?? "";

  const readProperty = (name: string): CallResult => (isValue ? value.get(name) : object.get(name));
  const writeProperty = (name: string, v: CallArg): void =>
    isValue ? value.set(name, v) : object.set(name, v);
  const method = (name: string, options: ValueMethodResolveOptions = {}) =>
    isValue ? value.method(name, options) : object.method(name, options);
  const invoke = (name: string, args: CallArg[]): CallResult | Promise<CallResult> => {
    const options: MethodResolveOptions = { arity: args.length };
    if (args.some((a) => a instanceof ClosureSpec)) {
      options.typeArguments = []; // generic path; planGenericMethod infers the closure-result R
    }
    return method(name, options).call(...args);
  };

  let index: MemberIndex | null = null;
  const members = (): MemberIndex => {
    if (index === null) {
      index = {
        methods: new Set(
          enumerateMethods(fullName())
            .filter((m) => m.kind === "method" && !m.isStatic)
            .map((m) => m.name)
        ),
        properties: new Set(
          enumerateProperties(fullName()).filter((p) => !p.isStatic).map((p) => p.name)
        ),
      };
    }
    return index;
  };

  const callables = new Map<string, (...args: CallArg[]) => CallResult | Promise<CallResult>>();

  const proxy = new Proxy(target, {
    has(t, key) {
      if (typeof key !== "string") {
        return Reflect.has(t, key);
      }
      const m = members();
      return RESERVED.has(key) || m.methods.has(key) || m.properties.has(key);
    },
    get(t, key) {
      if (typeof key === "symbol") {
        if (key === RAW) {
          return t;
        }
        const member = Reflect.get(t, key);
        return typeof member === "function" ? member.bind(t) : member;
      }
      switch (key) {
        case "$handle":
          return handle();
        case "$kind":
          return target.kind;
        case "$type":
          return target.type;
        case "$className":
          return typeName(dynamicType());
        case "$fields":
          return isValue ? value.read() : object.read();
        case "$owned":
          return target.owned;
        case "$call":
          return (name: string, ...args: CallArg[]) => invoke(name, args);
        case "$method":
          return (name: string, options: MethodResolveOptions = {}) => method(name, options);
        case "$get":
          return (name: string) => readProperty(name);
        case "$set":
          return (name: string, v: CallArg) => writeProperty(name, v);
        case "$field":
          return (name: string) => target.field(name);
        case "$container":
          return () => {
            if (!isValue) throw new Error("$container is only valid on value instances");
            return value.container();
          };
        case "$vtable":
          if (isValue) throw new Error("$vtable is only valid on class instances");
          return object.vtable;
        case "$vtableMethod":
          return (offset: number, signature: Parameters<ClassInstance["vtableMethod"]>[1]) => {
            if (isValue) throw new Error("$vtableMethod is only valid on class instances");
            return object.vtableMethod(offset, signature);
          };
        case "$retain":
          return () => {
            if (isValue) throw new Error("$retain is only valid on class instances");
            object.retain();
            return proxy;
          };
        case "$release":
          return () => {
            if (isValue) throw new Error("$release is only valid on class instances");
            object.release();
          };
        case "$dispose":
          return () => target.dispose();
        case "toJSON":
          return () => target.toJSON();
        case "equals":
          return (other: SwiftObject | ClassInstance | ValueInstance | NativePointer) =>
            handle().equals(handleOf(other));
        case "hasOwnProperty":
          return (k: string) => {
            const m = members();
            return RESERVED.has(k) || m.methods.has(k) || m.properties.has(k);
          };
        case "toString":
        case "valueOf":
          return () => `<${fullName() || "Swift.Object"}: ${handle()}>`;
      }
      if (POISON.has(key)) {
        return undefined;
      }
      const m = members();
      if (m.properties.has(key)) {
        return readProperty(key);
      }
      if (m.methods.has(key)) {
        let fn = callables.get(key);
        if (fn === undefined) {
          fn = (...args: CallArg[]) => invoke(key, args);
          callables.set(key, fn);
        }
        return fn;
      }
      return undefined;
    },
    set() {
      return false;
    },
    ownKeys() {
      return ["$handle", ...members().methods];
    },
    getOwnPropertyDescriptor() {
      return { writable: false, configurable: true, enumerable: true };
    },
  });
  return proxy as unknown as SwiftObject;
}
