import { HeapObject } from "../abi/heap-object.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { Metadata } from "../abi/metadata.js";
import { Value } from "../abi/value.js";
import { SwiftValue } from "../abi/instance.js";
import { CallResult, MethodInfo, enumerateMethods } from "./method.js";

const RESERVED = new Set([
  "handle",
  "toString",
  "valueOf",
  "equals",
  "hasOwnProperty",
  "$metadata",
  "$dynamicType",
  "$fields",
  "$methods",
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
  readonly $metadata: ClassMetadata;
  readonly $dynamicType: Metadata;
  readonly $fields: { [name: string]: SwiftValue };
  readonly $methods: string[];
  readonly $owned: boolean;
  $call(name: string, ...args: SwiftValue[]): CallResult;
  $get(name: string): CallResult;
  $set(name: string, value: SwiftValue): void;
  $field(name: string): Value;
  $retain(): SwiftObject;
  $release(): void;
  $dispose(): void;
  equals(other: SwiftObject | HeapObject | NativePointer): boolean;
  toString(): string;
  [key: string]: any;
}

// "greet(name:to:)" → "greet$name_to_"; unlabelled args contribute a bare "_"; no-arg stays "greet".
function escapeSelector(name: string, argLabels: (string | null)[]): string {
  if (argLabels.length === 0) {
    return name;
  }
  return `${name}$${argLabels.map((l) => `${l ?? ""}_`).join("")}`;
}

function handleOf(other: SwiftObject | HeapObject | NativePointer): NativePointer {
  return (other instanceof NativePointer ? other : other.handle) as NativePointer;
}

// Owns when handed an owned HeapObject (init/call/adopt): the proxy roots its target, so the +1
// outlives reachability and releases on GC. A raw pointer is wrapped as a borrow.
export function createObject(source: NativePointer | HeapObject): SwiftObject {
  const target = source instanceof HeapObject ? source : new HeapObject(source);
  const callables = new Map<string, (...args: SwiftValue[]) => CallResult>();
  let keyMap: Map<string, MethodInfo> | null = null;

  const methodKeys = (): Map<string, MethodInfo> => {
    if (keyMap !== null) {
      return keyMap;
    }
    const typeName = target.metadata.description.fullTypeName ?? "";
    const map = new Map<string, MethodInfo>();
    for (const info of enumerateMethods(typeName)) {
      if (info.isStatic || info.kind !== "method") {
        continue;
      }
      const base = escapeSelector(info.name, info.argLabels);
      let key = base;
      for (let serial = 2; map.has(key); serial++) {
        key = `${base}${serial}`;
      }
      map.set(key, info);
    }
    keyMap = map;
    return map;
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
        case "$metadata":
          return t.metadata;
        case "$dynamicType":
          return t.dynamicType;
        case "$fields":
          return t.read();
        case "$methods":
          return [...methodKeys().keys()];
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
          return (other: SwiftObject | HeapObject | NativePointer) => t.handle.equals(handleOf(other));
        case "hasOwnProperty":
          return (k: string) => RESERVED.has(k) || Reflect.has(t, k) || methodKeys().has(k);
        case "toString":
        case "valueOf":
          return () => `<${t.metadata.description.fullTypeName ?? "Swift.Object"}: ${t.handle}>`;
      }
      // The low-level HeapObject API wins over a same-named no-arg Swift method (reach the latter
      // via $call); escaped selectors (greet$_) never collide with it.
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
