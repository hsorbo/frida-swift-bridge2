import { test, expect, describe } from "@frida/injest/agent";

import { Metadata, MetadataKind } from "../src/abi/metadata.js";
import { tupleNumElements, tupleLabels, enumerateTupleElements } from "../src/abi/tuple.js";

describe("tuple metadata", () => {
  test("reads element count, labels and per-element type/offset", () => {
    const elementType0 = Memory.alloc(Process.pointerSize);
    elementType0.writeU32(MetadataKind.Struct);
    const elementType1 = Memory.alloc(Process.pointerSize);
    elementType1.writeU32(MetadataKind.Struct);

    const labels = Memory.allocUtf8String("first second ");

    const tuple = Memory.alloc(3 * Process.pointerSize + 2 * (2 * Process.pointerSize));
    tuple.writeU32(MetadataKind.Tuple);
    tuple.add(Process.pointerSize).writeU32(2);
    tuple.add(2 * Process.pointerSize).writePointer(labels);

    const elements = tuple.add(3 * Process.pointerSize);
    elements.writePointer(elementType0);
    elements.add(Process.pointerSize).writeU32(0);
    elements.add(2 * Process.pointerSize).writePointer(elementType1);
    elements.add(3 * Process.pointerSize).writeU32(8);

    const metadata = new Metadata(tuple);
    expect(tupleNumElements(metadata)).toBe(2);
    expect(tupleLabels(metadata)).toBe("first second ");

    const parsed = [...enumerateTupleElements(metadata)];
    expect(parsed.length).toBe(2);
    expect(parsed[0].type.handle.equals(elementType0)).toBeTruthy();
    expect(parsed[0].offset).toBe(0);
    expect(parsed[1].type.handle.equals(elementType1)).toBeTruthy();
    expect(parsed[1].offset).toBe(8);
  });

  test("returns null labels when there is no labels string", () => {
    const tuple = Memory.alloc(3 * Process.pointerSize);
    tuple.writeU32(MetadataKind.Tuple);
    tuple.add(Process.pointerSize).writeU32(0);
    tuple.add(2 * Process.pointerSize).writePointer(NULL);

    expect(tupleLabels(new Metadata(tuple))).toBeNull();
    expect([...enumerateTupleElements(new Metadata(tuple))].length).toBe(0);
  });
});
