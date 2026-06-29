import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { ClassMetadata } from "../src/abi/class-metadata.js";

describe("generic class instantiation", () => {
  test("instantiates a generic class metadata via its access function", () => {
    requireSwift();
    const int = Swift.metadataFor("Swift.Int")!;
    const storageInt = Swift.metadataFor("Swift._ContiguousArrayStorage", [int]);
    if (storageInt === null) {
      throw new Error("Swift._ContiguousArrayStorage not present");
    }
    expect(storageInt.kind).toBe(MetadataKind.Class);

    const cm = new ClassMetadata(storageInt.handle);
    expect(cm.isTypeMetadata).toBeTruthy();
    expect(cm.instanceSize).toBeGreaterThan(16);
    expect(cm.description.name).toBe("_ContiguousArrayStorage");

    const storageString = Swift.metadataFor("Swift._ContiguousArrayStorage", [
      Swift.metadataFor("Swift.String")!,
    ])!;
    expect(storageInt.handle.equals(storageString.handle)).toBeFalsy();
  });
});
