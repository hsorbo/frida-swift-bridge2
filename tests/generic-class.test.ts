import { test, expect, describe } from "@frida/injest/agent";

import { Swift } from "../src/index.js";
import { MetadataKind } from "../src/abi/metadata.js";
import { ClassMetadata } from "../src/abi/class-metadata.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

describe("generic class instantiation", () => {
  test("instantiates a generic class metadata via its access function", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const storageInt = Swift.metadataFor("Swift._ContiguousArrayStorage", [int]);
    if (storageInt === null) {
      skip("Swift._ContiguousArrayStorage not present");
      return;
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
