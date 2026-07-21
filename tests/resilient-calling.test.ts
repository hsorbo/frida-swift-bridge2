import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadResilient } from "./fixtures/load.js";

import { indirect, isResilientValueType, makeSwiftNativeFunction, metadataFor } from "../src/abi.js";

import { Swift } from "../src/index.js";
// resilient.dylib (-enable-library-evolution) gives a real resilience boundary without a system
// framework: ResilientPoint crosses it address-only, FrozenPoint stays direct.

function resilientFn(mod: Module, needle: string): NativePointer {
  for (const e of mod.enumerateExports()) {
    const d = Swift.demangle(e.name);
    if (d !== null && d.includes(needle)) {
      return e.address;
    }
  }
  throw new Error(`resilient export not found: ${needle}`);
}

function point(x: number, y: number): NativePointer {
  const p = Memory.alloc(16);
  p.writeU64(x);
  p.add(8).writeU64(y);
  return p;
}

function int(v: number): NativePointer {
  const p = Memory.alloc(8);
  p.writeU64(v);
  return p;
}

function xy(result: NativePointer): [number, number] {
  return [result.readU64().toNumber(), result.add(8).readU64().toNumber()];
}

describe("resilient calling convention (local library-evolution fixture)", () => {
  beforeEach(() => { loadResilient(); });

  test("a non-frozen resilient struct is passed @in / returned @out", () => {
    const mod = loadResilient();
    const RP = metadataFor("resilient.ResilientPoint")!;
    const Int = metadataFor("Swift.Int")!;
    const translate = resilientFn(mod, "resilient.translate(");

    const fn = makeSwiftNativeFunction(translate, indirect(RP), [indirect(RP), Int, Int]);
    expect(xy(fn(point(1, 2), int(10), int(20))!)).toEqual([11, 22]);
  });

  test("a @frozen struct in a resilient module keeps the direct ABI", () => {
    const mod = loadResilient();
    const FP = metadataFor("resilient.FrozenPoint")!;
    const Int = metadataFor("Swift.Int")!;
    const translate = resilientFn(mod, "resilient.translateFrozen(");

    const fn = makeSwiftNativeFunction(translate, FP, [FP, Int, Int]);
    expect(xy(fn(point(3, 4), int(100), int(200))!)).toEqual([103, 204]);
  });

  // swiftc emits no layout-string bit, so the heuristic can't see local resilient types — they need
  // the explicit AbstractIndirect used above. Pinned so the limitation is explicit, not silent.
  test("auto-detection does not fire for a locally-built resilient struct", () => {
    expect(isResilientValueType(metadataFor("resilient.ResilientPoint")!)).toBe(false);
    expect(isResilientValueType(metadataFor("resilient.FrozenPoint")!)).toBe(false);
  });
});
