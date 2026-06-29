import { ClassInstance } from "../abi/heap-object.js";
import { ValueInstance } from "../abi/value.js";
import { SwiftValue } from "../abi/instance.js";
import { CallResult, MethodInfo, enumerateMethods, buildKeyMap } from "./method.js";
import { typeName } from "./type-name.js";
import { SwiftType, typeOf } from "./swift-type.js";

const RESERVED = new Set([
  "handle",
  "toString",
  "valueOf",
  "equals",
  "hasOwnProperty",
  "$type",
  "$className",
  "$fields",
  "$owned",
  "$call",
  "$get",
  "$set",
  "$field",
  "$retain",
  "$release",
  "$dispose",
]);

export interface SwiftObject {
  readonly handle: NativePointer;
  readonly $type: SwiftType;
  readonly $className: string;
  readonly $fields: { [name: string]: SwiftValue };
  readonly $owned: boolean;
  $call(name: string, ...args: SwiftValue[]): CallResult;
  $get(name: string): CallResult;
  $set(name: string, value: SwiftValue): void;
  $field(name: string): ValueInstance;
  $retain(): SwiftObject;
  $release(): void;
  $dispose(): void;
  equals(other: SwiftObject | ClassInstance | NativePointer): boolean;
  toString(): string;
  [key: string]: any;
}

function handleOf(other: SwiftObject | ClassInstance | NativePointer): NativePointer {
  return (other instanceof NativePointer ? other : other.handle) as NativePointer;
}

// The proxy roots its target, so an owned target's +1 releases only when the proxy is GC'd.
export function createObject(source: NativePointer | ClassInstance): SwiftObject {
  const target = source instanceof ClassInstance ? source : new ClassInstance(source);
  const callables = new Map<string, (...args: SwiftValue[]) => CallResult>();
  let keyMap: Map<string, MethodInfo> | null = null;

  const fullName = (): string => target.metadata.description.fullTypeName ?? "";

  const methodKeys = (): Map<string, MethodInfo> => {
    if (keyMap === null) {
      keyMap = buildKeyMap(enumerateMethods(fullName()));
    }
    return keyMap;
  };

  const proxy = new Proxy(target, {
    has(t, key) {
      return typeof key === "string" && (RESERVED.has(key) || Reflect.has(t, key) || methodKeys().has(key));
    },
    get(t, key) {
      if (typeof key === "symbol") {
        const member = Reflect.get(t, key);
        return typeof member === "function" ? member.bind(t) : member;
      }
      switch (key) {
        case "handle":
          return t.handle;
        case "$type":
          return typeOf(t.dynamicType);
        case "$className":
          return typeName(t.dynamicType);
        case "$fields":
          return t.read();
        case "$owned":
          return t.owned;
        case "$call":
          return (name: string, ...args: SwiftValue[]) => t.call(name, ...args);
        case "$get":
          return (name: string) => t.get(name);
        case "$set":
          return (name: string, value: SwiftValue) => t.set(name, value);
        case "$field":
          return (name: string) => t.field(name);
        case "$retain":
          return () => {
            t.retain();
            return proxy;
          };
        case "$release":
          return () => t.release();
        case "$dispose":
          return () => t.dispose();
        case "equals":
          return (other: SwiftObject | ClassInstance | NativePointer) => t.handle.equals(handleOf(other));
        case "hasOwnProperty":
          return (k: string) => RESERVED.has(k) || Reflect.has(t, k) || methodKeys().has(k);
        case "toString":
        case "valueOf":
          return () => `<${t.metadata.description.fullTypeName ?? "Swift.Object"}: ${t.handle}>`;
      }
      // A real ClassInstance member wins over a same-named no-arg Swift method (reach that via $call).
      if (Reflect.has(t, key)) {
        const member = Reflect.get(t, key);
        return typeof member === "function" ? member.bind(t) : member;
      }
      const info = methodKeys().get(key);
      if (info === undefined) {
        return undefined;
      }
      let fn = callables.get(key);
      if (fn === undefined) {
        const bound = t.method(info.name, { labels: info.argLabels });
        fn = (...args: SwiftValue[]) => bound.call(...args);
        callables.set(key, fn);
      }
      return fn;
    },
    set() {
      return false;
    },
    ownKeys() {
      return ["handle", ...methodKeys().keys()];
    },
    getOwnPropertyDescriptor() {
      return { writable: false, configurable: true, enumerable: true };
    },
  });
  return proxy as unknown as SwiftObject;
}
