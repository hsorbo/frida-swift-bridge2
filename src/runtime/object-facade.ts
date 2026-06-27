import { HeapObject } from "../abi/heap-object.js";
import { ClassMetadata } from "../abi/class-metadata.js";
import { Metadata } from "../abi/metadata.js";
import { SwiftValue } from "../abi/instance.js";
import { MethodInfo, enumerateMethods } from "./method.js";

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
  "$call",
  "$get",
  "$set",
  "$retain",
  "$release",
]);

export interface SwiftObject {
  readonly handle: NativePointer;
  readonly $metadata: ClassMetadata;
  readonly $dynamicType: Metadata;
  readonly $fields: { [name: string]: SwiftValue };
  readonly $methods: string[];
  $call(name: string, ...args: SwiftValue[]): SwiftValue;
  $get(name: string): SwiftValue;
  $set(name: string, value: SwiftValue): void;
  $retain(): SwiftObject;
  $release(): void;
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

export function createObject(handle: NativePointer): SwiftObject {
  const target = new HeapObject(handle);
  const callables = new Map<string, (...args: SwiftValue[]) => SwiftValue>();
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
    has(_t, key) {
      return typeof key === "string" && (RESERVED.has(key) || methodKeys().has(key));
    },
    get(t, key) {
      if (typeof key === "symbol") {
        return Reflect.get(t, key);
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
        case "$call":
          return (name: string, ...args: SwiftValue[]) => t.call(name, ...args);
        case "$get":
          return (name: string) => t.get(name);
        case "$set":
          return (name: string, value: SwiftValue) => t.set(name, value);
        case "$retain":
          return () => {
            t.retain();
            return proxy;
          };
        case "$release":
          return () => t.release();
        case "equals":
          return (other: SwiftObject | HeapObject | NativePointer) => handle.equals(handleOf(other));
        case "hasOwnProperty":
          return (k: string) => RESERVED.has(k) || methodKeys().has(k);
        case "toString":
        case "valueOf":
          return () => `<${t.metadata.description.fullTypeName ?? "Swift.Object"}: ${handle}>`;
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
