import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  AccessibleFunctionRecord,
  enumerateAccessibleFunctions,
  findAccessibleFunction,
} from "../src/index.js";
import { MetadataKind } from "../src/abi/metadata.js";

const ADD_MANGLED = "$s7fixture10CalculatorC3addyS2i_SitYaKFTE";
const ADD_DEMANGLED =
  "distributed thunk fixture.Calculator.add(Swift.Int, Swift.Int) async throws -> Swift.Int";

function within(module: Module, p: NativePointer): boolean {
  return p.compare(module.base) >= 0 && p.compare(module.base.add(module.size)) < 0;
}

describe("accessible functions", () => {
  test("enumerates the distributed thunks in __swift5_acfuncs", () => {
    const module = loadFixture();
    const records = [...enumerateAccessibleFunctions(module)];
    expect(records.length).toBe(2);
    for (const record of records) {
      expect(record instanceof AccessibleFunctionRecord).toBe(true);
      expect(record.isDistributed).toBe(true);
      expect(record.name.startsWith("$s7fixture10Calculator")).toBe(true);
      expect(within(module, record.functionPointer)).toBe(true);
    }
    const demangled = records.map((r) => r.demangledName);
    expect(demangled).toContain(ADD_DEMANGLED);
    expect(demangled.some((d) => d?.includes("Calculator.greet"))).toBe(true);
  });

  test("finds a record by its mangled name", () => {
    loadFixture();
    const record = findAccessibleFunction(ADD_MANGLED);
    expect(record).not.toBeNull();
    expect(record!.name).toBe(ADD_MANGLED);
    expect(record!.demangledName).toBe(ADD_DEMANGLED);
  });

  test("finds a record by its demangled spelling", () => {
    loadFixture();
    const record = findAccessibleFunction(ADD_DEMANGLED);
    expect(record).not.toBeNull();
    expect(record!.name).toBe(ADD_MANGLED);
  });

  test("returns null for an unknown name", () => {
    loadFixture();
    expect(findAccessibleFunction("does.not.Exist")).toBeNull();
  });

  test("resolves the function type as a Swift function metadata when available", () => {
    loadFixture();
    const record = findAccessibleFunction(ADD_MANGLED)!;
    const functionType = record.functionType;
    // A distributed thunk's type is often unresolvable out of context; tolerate null.
    if (functionType !== null) {
      expect(functionType.kind).toBe(MetadataKind.Function);
    }
  });
});
