import { test, expect, describe } from "@frida/injest/agent";
import { requireDarwin } from "./swift.js";
import { existentialMetadata } from "./fixtures/load.js";

import { MetadataKind } from "../src/abi/metadata.js";
import { typeOf, ForeignClassType } from "../src/runtime/swift-type.js";

describe("ForeignClass metadata", () => {
  test("routes a CF type to a ForeignClassType instead of a bare SwiftType", (ctx) => {
    requireDarwin(ctx);

    const metadata = existentialMetadata("fixture.foreignClassType");
    expect(metadata.kind).toBe(MetadataKind.ForeignClass);

    const type = typeOf(metadata);
    expect(type instanceof ForeignClassType).toBe(true);
    expect(type.name).toContain("CGColor");
    expect((type as ForeignClassType).description.handle.isNull()).toBe(false);
    expect(type.toJSON().kind).toBe("foreign-class");
  });
});
