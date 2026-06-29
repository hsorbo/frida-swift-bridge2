import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, readValue, type SwiftValue, type CallResult } from "../src/index.js";
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

function doubles(metadata: ReturnType<typeof Swift.metadataFor>, values: number[]): NativePointer {
  const p = Memory.alloc(metadata!.typeLayout.stride);
  values.forEach((v, i) => p.add(i * 8).writeDouble(v));
  return p;
}

function floats(metadata: ReturnType<typeof Swift.metadataFor>, values: number[]): NativePointer {
  const p = Memory.alloc(metadata!.typeLayout.stride);
  values.forEach((v, i) => p.add(i * 4).writeFloat(v));
  return p;
}

describe("homogeneous float aggregates (HFA)", () => {
  test("returns a 2-double HFA in d0/d1", () => {
    const DoublePair = Swift.metadataFor("fixture.DoublePair")!;
    const make = makeSwiftNativeFunction(fixtureAddress("fixture.makeDoublePair"), DoublePair, []);
    expect(readValue(DoublePair, make()!)).toEqual({ x: 1.5, y: 2.5 });
  });

  test("passes a 2-double HFA argument via d0/d1", () => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const DoublePair = Swift.metadataFor("fixture.DoublePair")!;
    const sum = makeSwiftNativeFunction(fixtureAddress("fixture.sumDoublePair"), Double_, [DoublePair]);
    expect(sum(doubles(DoublePair, [1.5, 2.5]))!.readDouble()).toBe(4);
  });

  test("returns and passes a 4-double HFA across d0–d3", () => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const DoubleQuad = Swift.metadataFor("fixture.DoubleQuad")!;
    const make = makeSwiftNativeFunction(fixtureAddress("fixture.makeDoubleQuad"), DoubleQuad, []);
    expect(readValue(DoubleQuad, make()!)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    const sum = makeSwiftNativeFunction(fixtureAddress("fixture.sumDoubleQuad"), Double_, [DoubleQuad]);
    expect(sum(doubles(DoubleQuad, [1, 2, 3, 4]))!.readDouble()).toBe(10);
  });

  test("returns and passes a 2-float HFA via s0/s1", () => {
    const Float_ = Swift.metadataFor("Swift.Float")!;
    const FloatPair = Swift.metadataFor("fixture.FloatPair")!;
    const make = makeSwiftNativeFunction(fixtureAddress("fixture.makeFloatPair"), FloatPair, []);
    expect(readValue(FloatPair, make()!)).toEqual({ u: 1.25, v: 3.75 });
    const sum = makeSwiftNativeFunction(fixtureAddress("fixture.sumFloatPair"), Float_, [FloatPair]);
    expect(sum(floats(FloatPair, [1.25, 3.75]))!.readFloat()).toBe(5);
  });

  test("hook decodes an HFA argument and return", () => {
    const Double_ = Swift.metadataFor("Swift.Double")!;
    const DoublePair = Swift.metadataFor("fixture.DoublePair")!;
    const addr = fixtureAddress("fixture.sumDoublePair");
    let seenArgs: SwiftValue[] | null = null;
    const listener = SwiftInterceptor.attach(addr, {
      onEnter(args) {
        seenArgs = args;
      },
    });
    makeSwiftNativeFunction(addr, Double_, [DoublePair])(doubles(DoublePair, [1.5, 2.5]));
    listener.detach();
    expect(seenArgs).toEqual([{ x: 1.5, y: 2.5 }]);

    const mkAddr = fixtureAddress("fixture.makeDoublePair");
    let seenRet: CallResult = null;
    const l2 = SwiftInterceptor.attach(mkAddr, {
      onLeave(ret) {
        seenRet = ret;
      },
    });
    makeSwiftNativeFunction(mkAddr, DoublePair, [])();
    l2.detach();
    expect(seenRet).toEqual({ x: 1.5, y: 2.5 });
  });
});
