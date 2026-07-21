import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { fixtureExport, existentialMetadata } from "./fixtures/load.js";

import { Metadata, readValue, readObject, metadataFor } from "../src/abi.js";
import { MetadataKind } from "../src/abi/metadata.js";
import {
  extendedExistentialSpecialKind,
  ExtendedExistentialSpecialKind,
} from "../src/abi/existential.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

import { Swift } from "../src/index.js";
function ptrValue(p: NativePointer): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writePointer(p);
  return cell;
}

function store(fn: string, metadata: Metadata): NativePointer {
  const RawPointer = metadataFor("Swift.UnsafeMutableRawPointer")!;
  const container = Memory.alloc(metadata.typeLayout.stride);
  makeSwiftNativeFunction(fixtureExport(fn), null, [RawPointer])(ptrValue(container));
  return container;
}

describe("readValue extended existential", () => {
  test("decodes a value type behind a parameterized-protocol existential (opaque)", () => {
    requireSwift();
    const Holder = existentialMetadata("fixture.holderIntType");
    expect(Holder.kind).toBe(MetadataKind.ExtendedExistential);
    expect(extendedExistentialSpecialKind(Holder)).toBe(ExtendedExistentialSpecialKind.None);
    expect(readValue(Holder, store("fixture.storeHolderInt", Holder))).toEqual({ item: int64(42) });
  });

  test("decodes a class reference behind a class-constrained parameterized existential", () => {
    requireSwift();
    const Ref = existentialMetadata("fixture.refIntType");
    expect(Ref.kind).toBe(MetadataKind.ExtendedExistential);
    expect(extendedExistentialSpecialKind(Ref)).toBe(ExtendedExistentialSpecialKind.Class);
    const ref = readValue(Ref, store("fixture.storeRefInt", Ref)) as NativePointer;
    expect(ref.isNull()).toBe(false);
    expect(readObject(ref)).toEqual({ value: int64(7) });
  });

  test("decodes the stored type behind a parameterized-protocol existential metatype (any P.Type)", () => {
    requireSwift();
    const M = existentialMetadata("fixture.holderMetatypeType");
    expect(M.kind).toBe(MetadataKind.ExtendedExistential);
    expect(extendedExistentialSpecialKind(M)).toBe(ExtendedExistentialSpecialKind.Metatype);
    expect(readValue(M, store("fixture.storeHolderMetatype", M))).toBe("fixture.IntHolder");
  });
});
