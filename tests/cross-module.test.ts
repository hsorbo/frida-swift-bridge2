import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import {
  enumerateSwiftModules,
  enumerateTypes,
} from "../src/reflection/registry.js";

function requireOnoneSupport(): void {
  requireSwift();
  Module.load("/usr/lib/swift/libswiftSwiftOnoneSupport.dylib");
}

describe("cross-module descriptor walk", () => {
  test("every type descriptor is aligned and resolves its module name", () => {
    requireOnoneSupport();

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

  test("resolves indirect type-descriptor records to named types", () => {
    requireOnoneSupport();

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
