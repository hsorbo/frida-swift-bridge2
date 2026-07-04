import { test, expect, describe } from "@frida/injest/agent";

import { Metadata, MetadataKind } from "../src/abi/metadata.js";
import { metatypeInstanceType } from "../src/abi/metatype.js";

describe("metatype metadata", () => {
  test("reads the instance type pointer", () => {
    const instance = Memory.alloc(Process.pointerSize);
    instance.writeU32(MetadataKind.Struct);

    const metatype = Memory.alloc(2 * Process.pointerSize);
    metatype.writeU32(MetadataKind.Metatype);
    metatype.add(Process.pointerSize).writePointer(instance);

    const resolved = metatypeInstanceType(new Metadata(metatype));
    expect(resolved.handle.equals(instance)).toBeTruthy();
    expect(resolved.kind).toBe(MetadataKind.Struct);
  });
});
