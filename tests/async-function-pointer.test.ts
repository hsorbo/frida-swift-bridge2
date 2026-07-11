import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { findAccessibleFunction, AsyncFunctionPointer } from "../src/index.js";

const ADD_MANGLED = "$s7fixture10CalculatorC3addyS2i_SitYaKFTE";

function within(module: Module, p: NativePointer): boolean {
  return p.compare(module.base) >= 0 && p.compare(module.base.add(module.size)) < 0;
}

describe("async function pointer", () => {
  test("resolves a distributed thunk's record to code in the module", () => {
    const module = loadFixture();
    const record = findAccessibleFunction(ADD_MANGLED)!;
    const afp = record.asyncFunctionPointer;
    expect(afp instanceof AsyncFunctionPointer).toBe(true);
    expect(within(module, afp.code)).toBe(true);
    expect(afp.code.equals(record.functionPointer)).toBe(false);
    expect(afp.expectedContextSize).toBeGreaterThan(0);
  });
});
