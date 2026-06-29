import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Metadata, ValueInstance, type SwiftValue, type SwiftObject, type CallResult } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";
import { SwiftInterceptor } from "../src/runtime/interceptor.js";

function fixtureAddress(swiftName: string): NativePointer {
  const mod = loadFixture();
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

function existentialMetadata(accessor: string): Metadata {
  const RawPointer = Swift.metadataFor("Swift.UnsafeRawPointer")!;
  const get = makeSwiftNativeFunction(fixtureAddress(accessor), RawPointer, []);
  return new Metadata(get()!.readPointer());
}

describe("SwiftInterceptor.attach", () => {
  test("decodes scalar arguments and the scalar return", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const addr = fixtureAddress("fixture.addInts");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("decodes a direct (register-exploded) struct argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const addr = fixtureAddress("fixture.sumLoadable");
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

  test("decodes an indirect struct argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const addr = fixtureAddress("fixture.sumBig");
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

  test("decodes an indirect (x8) struct return", () => {
    const Big = Swift.metadataFor("fixture.BigStruct")!;
    const addr = fixtureAddress("fixture.makeBigStruct");
    let seen: CallResult = null;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        seen = ret;
      },
    });
    makeSwiftNativeFunction(addr, Big, [])();
    listener.detach();
    expect(seen).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
  });

  test("decodes a direct (multi-register) struct return", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const addr = fixtureAddress("fixture.makeLoadableStruct");
    let seen: CallResult = null;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        seen = ret;
      },
    });
    makeSwiftNativeFunction(addr, Loadable, [])();
    listener.detach();
    expect(seen).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  test("recovers a generic scalar argument and return from the implicit metadata", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const identity = fixtureAddress("fixture.genericIdentity");
    const driver = fixtureAddress("fixture.makeGenericInt");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("recovers a generic struct argument from the implicit metadata", () => {
    const Loadable = Swift.metadataFor("fixture.LoadableStruct")!;
    const identity = fixtureAddress("fixture.genericIdentity");
    const driver = fixtureAddress("fixture.makeGenericStruct");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("recovers two generic params of different concrete types", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const first = fixtureAddress("fixture.genericFirst");
    const driver = fixtureAddress("fixture.makeGenericPair");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("decodes a generic function taking a metatype argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const identity = fixtureAddress("fixture.metatypeIdentity");
    const driver = fixtureAddress("fixture.makeMetatypeInt");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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
    expect(seenArgs).toEqual(["Swift.Int", 5]);
    expect(seenRet).toBe(5);
  });

  test("decodes a constrained generic arg, ignoring the trailing witness table", () => {
    const scaleGeneric = fixtureAddress("fixture.scaleGeneric");
    const driver = fixtureAddress("fixture.makeScaleGeneric");
    const Int = Swift.metadataFor("Swift.Int")!;
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("decodes a Double argument and return from the FP registers", () => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const addr = fixtureAddress("fixture.scaleDouble");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
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

  test("surfaces a thrown error on leave instead of decoding a bogus return", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const addr = fixtureAddress("fixture.mightThrow");
    const seen: { retval: CallResult; error?: SwiftValue }[] = [];
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(retval, error) {
        seen.push({ retval, error });
      },
    });
    const call = makeSwiftNativeFunction(addr, Int, [Int], { throws: true });
    call(intValue(0));
    expect(() => call(intValue(1))).toThrow();
    listener.detach();
    expect(seen[0]).toEqual({ retval: 99, error: undefined });
    expect(seen[1]).toEqual({ retval: null, error: "boom" });
  });

  test("decodes a named-protocol existential argument, projecting the dynamic value", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const Greeter = existentialMetadata("fixture.greeterType");
    const g = makeSwiftNativeFunction(fixtureAddress("fixture.makeGreeterExistential"), Greeter, [])()!;
    const addr = fixtureAddress("fixture.greetExistential");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(addr, String_, [Greeter])(g);
    listener.detach();
    expect(seenArgs).toEqual([{ name: "Ada" }]);
    expect(seenRet).toBe("Hello, Ada");
  });

  test("decodes a protocol-composition existential argument, projecting the dynamic value", () => {
    const String_ = Swift.metadataFor("Swift.String")!;
    const GreeterAged = existentialMetadata("fixture.greeterAgedType");
    const v = makeSwiftNativeFunction(fixtureAddress("fixture.makeGreeterAged"), GreeterAged, [])()!;
    const addr = fixtureAddress("fixture.describeGreeterAged");
    let seenArgs: SwiftValue[] | null = null;
    let seenRet: CallResult = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seenArgs = args;
      },
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(addr, String_, [GreeterAged])(v);
    listener.detach();
    expect(seenArgs).toEqual([{ name: "Cy", age: 9 }]);
    expect(seenRet).toBe("Hi, Cy (9)");
  });

  test("hands back a class return as a live SwiftObject facade", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Counter = Swift.metadataFor("fixture.Counter")!;
    const addr = fixtureAddress("fixture.makeCounter");
    let seen: CallResult = null;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        seen = ret;
      },
    });
    makeSwiftNativeFunction(addr, Counter, [Int])(intValue(7));
    listener.detach();
    const counter = seen as unknown as SwiftObject;
    expect(counter.$className).toBe("fixture.Counter");
    expect(counter.$get("count")).toBe(7);
  });

  // The borrowed ValueInstance aliases the caller's result storage, so it is read inside onLeave; the field
  // probes prove it is the live aggregate, not a deep-copied snapshot.
  test("hands back a non-POD value return as a live, queryable ValueInstance", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Token = Swift.metadataFor("fixture.Token")!;
    const Wrapper = Swift.metadataFor("fixture.Wrapper")!;
    const tokenBuf = makeSwiftNativeFunction(fixtureAddress("fixture.makeToken"), Token, [Int])(intValue(7))!;
    const addr = fixtureAddress("fixture.makeWrapper");
    let isValue = false;
    let a: SwiftValue = null;
    let tokenMatches = false;
    const listener = SwiftInterceptor.attach(addr, {
      onLeave(ret) {
        isValue = ret instanceof ValueInstance;
        const wrapper = ret as ValueInstance;
        a = wrapper.field("a").get();
        tokenMatches = (wrapper.field("token").get() as NativePointer).equals(tokenBuf.readPointer());
      },
    });
    makeSwiftNativeFunction(addr, Wrapper, [Token])(tokenBuf);
    listener.detach();
    expect(isValue).toBe(true);
    expect(a).toBe(1);
    expect(tokenMatches).toBe(true);
  });
});
