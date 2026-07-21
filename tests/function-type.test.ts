import { test, expect, describe } from "@frida/injest/agent";

import { Metadata, MetadataKind } from "../src/abi/metadata.js";
import {
  readFunctionType,
  FunctionMetadataConvention,
  FunctionMetadataDifferentiabilityKind,
  FunctionIsolation,
  ParameterOwnership,
} from "../src/abi/function-type.js";

import { Swift } from "../src/index.js";
function allocType(kind: MetadataKind): NativePointer {
  const type = Memory.alloc(Process.pointerSize);
  type.writeU32(kind);
  return type;
}

describe("function type metadata", () => {
  test("decodes flags, parameters and all optional trailing records", () => {
    const ptr = Process.pointerSize;
    const resultType = allocType(MetadataKind.Struct);
    const paramType0 = allocType(MetadataKind.Struct);
    const paramType1 = allocType(MetadataKind.Struct);
    const paramType2 = allocType(MetadataKind.Struct);
    const globalActor = allocType(MetadataKind.Class);
    const thrownError = allocType(MetadataKind.Struct);

    const differentiabilityKindOffset = 8 * ptr; // alignUp(6 * ptr + 3 * 4, ptr)
    const globalActorOffset = differentiabilityKindOffset + ptr;
    const extendedFlagsOffset = globalActorOffset + ptr;
    const thrownErrorOffset = extendedFlagsOffset + ptr; // alignUp(.. + 4, ptr)

    const fn = Memory.alloc(thrownErrorOffset + ptr);
    fn.writeU32(MetadataKind.Function);

    const numParameters = 3;
    const rawFlags =
      numParameters |
      (0 << 16) | // FunctionMetadataConvention.Swift
      0x01000000 | // throws
      0x02000000 | // has parameter flags
      0x04000000 | // escaping
      0x08000000 | // differentiable
      0x10000000 | // has global actor
      0x20000000 | // async
      0x40000000 | // sendable
      0x80000000; // has extended flags
    fn.add(ptr).writeU32(rawFlags >>> 0);
    fn.add(2 * ptr).writePointer(resultType);

    const parameters = fn.add(3 * ptr);
    parameters.writePointer(paramType0);
    parameters.add(ptr).writePointer(paramType1);
    parameters.add(2 * ptr).writePointer(paramType2);

    const parameterFlags = fn.add(6 * ptr);
    parameterFlags.writeU32(0x83); // Owned | isVariadic
    parameterFlags.add(4).writeU32(0x901); // InOut | isAutoClosure | isSending
    parameterFlags.add(8).writeU32(0); // Default, no bits

    fn.add(differentiabilityKindOffset).writeU32(FunctionMetadataDifferentiabilityKind.Reverse);
    fn.add(globalActorOffset).writePointer(globalActor);
    fn.add(extendedFlagsOffset).writeU32(0x13 | (0b11 << 16)); // + inverted Copyable|Escapable
    fn.add(thrownErrorOffset).writePointer(thrownError);

    const result = readFunctionType(new Metadata(fn));

    expect(result.numParameters).toBe(3);
    expect(result.convention).toBe(FunctionMetadataConvention.Swift);
    expect(result.isAsync).toBeTruthy();
    expect(result.isThrowing).toBeTruthy();
    expect(result.isEscaping).toBeTruthy();
    expect(result.isSendable).toBeTruthy();
    expect(result.isDifferentiable).toBeTruthy();
    expect(result.differentiabilityKind).toBe(FunctionMetadataDifferentiabilityKind.Reverse);
    expect(result.resultType.handle.equals(resultType)).toBeTruthy();

    expect(result.parameters.length).toBe(3);
    expect(result.parameters[0].type.handle.equals(paramType0)).toBeTruthy();
    expect(result.parameters[0].ownership).toBe(ParameterOwnership.Owned);
    expect(result.parameters[0].isVariadic).toBeTruthy();
    expect(result.parameters[1].type.handle.equals(paramType1)).toBeTruthy();
    expect(result.parameters[1].ownership).toBe(ParameterOwnership.InOut);
    expect(result.parameters[1].isAutoClosure).toBeTruthy();
    expect(result.parameters[1].isSending).toBeTruthy();
    expect(result.parameters[2].type.handle.equals(paramType2)).toBeTruthy();
    expect(result.parameters[2].ownership).toBe(ParameterOwnership.Default);
    expect(result.parameters[2].isVariadic).toBeFalsy();

    expect(result.globalActor).not.toBeNull();
    expect(result.globalActor!.handle.equals(globalActor)).toBeTruthy();
    expect(result.isolation).toBe(FunctionIsolation.IsolatedAny);
    expect(result.hasSendingResult).toBeTruthy();
    expect(result.thrownError).not.toBeNull();
    expect(result.thrownError!.handle.equals(thrownError)).toBeTruthy();
    expect(result.invertedProtocols).toBe(0b11);
  });

  test("leaves every optional trailing record absent for a plain thin function", () => {
    const ptr = Process.pointerSize;
    const resultType = allocType(MetadataKind.Struct);
    const paramType0 = allocType(MetadataKind.Struct);

    const fn = Memory.alloc(4 * ptr);
    fn.writeU32(MetadataKind.Function);
    fn.add(ptr).writeU32(1 | (FunctionMetadataConvention.CFunctionPointer << 16));
    fn.add(2 * ptr).writePointer(resultType);
    fn.add(3 * ptr).writePointer(paramType0);

    const result = readFunctionType(new Metadata(fn));

    expect(result.numParameters).toBe(1);
    expect(result.convention).toBe(FunctionMetadataConvention.CFunctionPointer);
    expect(result.isThrowing).toBeFalsy();
    expect(result.isAsync).toBeFalsy();
    expect(result.isDifferentiable).toBeFalsy();
    expect(result.differentiabilityKind).toBe(FunctionMetadataDifferentiabilityKind.NonDifferentiable);
    expect(result.parameters[0].ownership).toBe(ParameterOwnership.Default);
    expect(result.parameters[0].isVariadic).toBeFalsy();
    expect(result.globalActor).toBeNull();
    expect(result.isolation).toBe(FunctionIsolation.NonIsolated);
    expect(result.hasSendingResult).toBeFalsy();
    expect(result.thrownError).toBeNull();
    expect(result.invertedProtocols).toBe(0);
  });
});
