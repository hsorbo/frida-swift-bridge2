import { test, expect, describe } from "@frida/injest/agent";
import { loadSwiftCore } from "./swift.js";

import {
  getSwiftSection,
  enumerateTypeContextDescriptors,
} from "../src/macho/sections.js";
import { ContextDescriptor } from "../src/abi/context-descriptor.js";

describe("mach-o swift sections", () => {
  test("finds __swift5_types in libswiftCore", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const section = getSwiftSection(lib, "__swift5_types");
    expect(section).toBeDefined();
    expect(section!.size).toBeGreaterThan(0);
  });

  test("returns null for a module without Swift metadata", ({ skip }) => {
    loadSwiftCore(skip);
    const noSwift = Process.getModuleByName("libsystem_kernel.dylib");
    expect(getSwiftSection(noSwift, "__swift5_types")).toBeNull();
  });

  test("enumerates type descriptors lazily and reads their names", ({ skip }) => {
    const lib = loadSwiftCore(skip);
    const section = getSwiftSection(lib, "__swift5_types")!;
    const limit = lib.base.add(lib.size);

    let count = 0;
    const names = new Set<string>();
    for (const descriptor of enumerateTypeContextDescriptors(lib)) {
      expect(descriptor.compare(lib.base) >= 0 && descriptor.compare(limit) < 0).toBeTruthy();
      const name = new ContextDescriptor(descriptor).name;
      if (name !== null) {
        names.add(name);
      }
      count++;
    }

    expect(count).toBeGreaterThan(0);
    expect(count).toBe(section.size / 4);
    const wellKnown = ["Int", "String", "Array", "Bool", "Double"];
    expect(wellKnown.some((n) => names.has(n))).toBeTruthy();
  });
});
