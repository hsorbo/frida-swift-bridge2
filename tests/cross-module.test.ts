import { test, expect, describe } from "@frida/injest/agent";

import { Swift } from "../src/index.js";
import {
  enumerateSwiftModules,
  enumerateTypes,
} from "../src/reflection/registry.js";

function requireSwift(skip: (reason?: string) => void): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
  Module.load("/usr/lib/swift/libswiftSwiftOnoneSupport.dylib");
}

describe("cross-module descriptor walk", () => {
  test("every type descriptor is aligned and resolves its module name", ({ skip }) => {
    requireSwift(skip);

    let types = 0;
    let named = 0;
    for (const module of enumerateSwiftModules()) {
      for (const descriptor of enumerateTypes(module)) {
        types++;
        expect(descriptor.handle.and(0x3).isNull()).toBeTruthy();
        if (descriptor.moduleName !== null) {
          named++;
        }
      }
    }

    expect(types).toBeGreaterThan(1000);
    expect(named).toBe(types);
  });

  test("resolves indirect type-descriptor records to named types", ({ skip }) => {
    requireSwift(skip);

    const onone = Process.getModuleByName("libswiftSwiftOnoneSupport.dylib");
    let withName = 0;
    for (const descriptor of enumerateTypes(onone)) {
      if (descriptor.name !== null && descriptor.name.length > 0) {
        withName++;
      }
    }
    expect(withName).toBeGreaterThan(0);
  });
});
