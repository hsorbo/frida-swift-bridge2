import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixtureSyms } from "./fixtures/load.js";
import { requireSwift } from "./swift.js";

import { metadataFor, resolveMethod } from "../src/abi.js";
import { resolveTypeExpr } from "../src/runtime/symbolication.js";

describe("borrow-modifier strip in resolveTypeExpr", () => {
  test("a leading __shared / borrowing resolves to the same type as the bare name", () => {
    requireSwift();
    const bare = resolveTypeExpr("Swift.String", () => null);
    expect(bare).not.toBeNull();
    for (const spelling of ["__shared Swift.String", "borrowing Swift.String"]) {
      const stripped = resolveTypeExpr(spelling, () => null);
      expect(stripped).not.toBeNull();
      expect(stripped!.handle.equals(bare!.handle)).toBe(true);
    }
  });

  // fixturesyms.SharedName.init(name: __shared Swift.String): the arg-type resolver would throw on the
  // `__shared` prefix without the strip, so resolving the init at all exercises it.
  test("resolveMethod resolves an init whose param demangles as __shared", () => {
    requireSwift();
    loadFixtureSyms();
    const resolved = resolveMethod("fixturesyms.SharedName", "init", { labels: ["name"] });
    expect(resolved.argTypes.length).toBe(1);
    expect(resolved.argTypes[0].handle.equals(metadataFor("Swift.String")!.handle)).toBe(true);
  });
});
