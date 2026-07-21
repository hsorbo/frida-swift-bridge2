import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadResilient } from "./fixtures/load.js";

import { Swift, StructType, SwiftObject } from "../src/index.js";

// resilient.ResilientHolder wraps a class ref (like Foundation.URL wraps NSURL): resilient ABI
// (returned @out) yet non-POD. Optional<ResilientHolder> must inherit that address-only ABI and be
// decoded/destroyed through its payload, not the Optional wrapper.
function holderType(): StructType {
  return Swift.typeOf(Swift.metadataFor("resilient.ResilientHolder")!) as StructType;
}

describe("Optional<resilient struct wrapping a class ref> return", () => {
  beforeEach(() => {
    loadResilient();
    Swift.markResilient("resilient");
  });

  test(".some unwraps to a facade whose class ref survives decode and destroy", () => {
    const holder = holderType().call("make", 7) as SwiftObject;
    expect(holder).not.toBeNull();
    expect(holder.$kind).toBe("value");
    expect(holder.$call("tokenId")).toEqual(int64(7));
    holder.$dispose();
  });

  test(".none decodes to null", () => {
    expect(holderType().call("make", -1)).toBeNull();
  });

  test("a failable initializer returns a facade or null", () => {
    const holder = holderType();
    expect(holder.initializer({ labels: ["id"] }).call(9)).not.toBeNull();
    expect(holder.initializer({ labels: ["id"] }).call(-1)).toBeNull();
  });
});
