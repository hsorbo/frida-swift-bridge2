import { test, expect, describe } from "@frida/injest/agent";
import { type Skip } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, type SwiftValue } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";
import { SwiftInterceptor } from "../src/runtime/interceptor.js";

function fixtureAddress(skip: Skip, swiftName: string): NativePointer {
  const mod = loadFixture(skip);
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

function intValue(v: number): NativePointer {
  const p = Memory.alloc(8);
  p.writeU64(v);
  return p;
}

function structValue(metadata: ReturnType<typeof Swift.metadataFor>, fields: number[]): NativePointer {
  const p = Memory.alloc(metadata!.typeLayout.stride);
  fields.forEach((v, i) => p.add(i * 8).writeU64(v));
  return p;
}

describe("SwiftInterceptor.attach", () => {
  test("decodes scalar arguments and the scalar return", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const addr = fixtureAddress(skip, "fixture.addInts");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(addr, Int, [Int, Int])(intValue(20), intValue(22));
    listener.detach();
    expect(seenArgs).toEqual([20, 22]);
    expect(seenRet).toBe(42);
  });

  test("decodes a direct (register-exploded) struct argument", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const addr = fixtureAddress(skip, "fixture.sumLoadable");
    let seen: SwiftValue[] | null = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seen = args;
      },
    });
    makeSwiftNativeFunction(addr, Int, [Loadable])(structValue(Loadable, [1, 2, 3, 4]));
    listener.detach();
    expect(seen).toEqual([{ a: 1, b: 2, c: 3, d: 4 }]);
  });

  test("decodes an indirect struct argument", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const addr = fixtureAddress(skip, "fixture.sumBig");
    let seen: SwiftValue[] | null = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seen = args;
      },
    });
    makeSwiftNativeFunction(addr, Int, [Big])(structValue(Big, [1, 2, 3, 4, 5]));
    listener.detach();
    expect(seen).toEqual([{ a: 1, b: 2, c: 3, d: 4, e: 5 }]);
  });

  test("decodes an indirect (x8) struct return", ({ skip }) => {
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const addr = fixtureAddress(skip, "fixture.makeBigStruct");
    let seen: SwiftValue = null;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        seen = ret;
      },
    });
    makeSwiftNativeFunction(addr, Big, [])();
    listener.detach();
    expect(seen).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
  });

  test("decodes a direct (multi-register) struct return", ({ skip }) => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const addr = fixtureAddress(skip, "fixture.makeLoadableStruct");
    let seen: SwiftValue = null;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        seen = ret;
      },
    });
    makeSwiftNativeFunction(addr, Loadable, [])();
    listener.detach();
    expect(seen).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  test("recovers a generic scalar argument and return from the implicit metadata", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const identity = fixtureAddress(skip, "fixture.genericIdentity");
    const driver = fixtureAddress(skip, "fixture.makeGenericInt");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(identity, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(driver, Int, [])();
    listener.detach();
    expect(seenArgs).toEqual([7]);
    expect(seenRet).toBe(7);
  });

  test("recovers a generic struct argument from the implicit metadata", ({ skip }) => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const identity = fixtureAddress(skip, "fixture.genericIdentity");
    const driver = fixtureAddress(skip, "fixture.makeGenericStruct");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(identity, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(driver, Loadable, [])();
    listener.detach();
    expect(seenArgs).toEqual([{ a: 5, b: 6, c: 7, d: 8 }]);
    expect(seenRet).toEqual({ a: 5, b: 6, c: 7, d: 8 });
  });

  test("recovers two generic params of different concrete types", ({ skip }) => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const first = fixtureAddress(skip, "fixture.genericFirst");
    const driver = fixtureAddress(skip, "fixture.makeGenericPair");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(first, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(driver, Int, [])();
    listener.detach();
    expect(seenArgs).toEqual([11, "ignored"]);
    expect(seenRet).toBe(11);
  });

  test("decodes a constrained generic arg, ignoring the trailing witness table", ({ skip }) => {
    const scaleGeneric = fixtureAddress(skip, "fixture.scaleGeneric");
    const driver = fixtureAddress(skip, "fixture.makeScaleGeneric");
    const Int = Swift.metadataFor("Swift.Int")!;
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(scaleGeneric, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(driver, Int, [])();
    listener.detach();
    expect(seenArgs).toEqual([6, 7]);
    expect(seenRet).toBe(42);
  });

  test("decodes a Double argument and return from the FP registers", ({ skip }) => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const addr = fixtureAddress(skip, "fixture.scaleDouble");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: SwiftValue = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    const arg = Memory.alloc(8);
    arg.writeDouble(21);
    makeSwiftNativeFunction(addr, Double_, [Double_])(arg);
    listener.detach();
    expect(seenArgs).toEqual([21]);
    expect(seenRet).toBe(42);
  });
});
