import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift } from "../src/index.js";

import { metadataFor, typeName } from "../src/abi.js";
describe("typeName", () => {
  test("names a concrete stdlib type", () => {
    requireSwift();
    expect(typeName(metadataFor("Swift.Int")!)).toBe("Swift.Int");
  });

  test("names a generic instantiation with its type arguments", () => {
    requireSwift();
    const int = metadataFor("Swift.Int")!;
    const arrayInt = typeName(metadataFor("Swift.Array", [int])!);
    expect(arrayInt).toContain("Array");
    expect(arrayInt).toContain("Int");

    const dict = typeName(
      metadataFor("Swift.Dictionary", [metadataFor("Swift.String")!, int])!
    );
    expect(dict).toContain("Dictionary");
    expect(dict).toContain("String");
    expect(dict).toContain("Int");
  });

  test("typeName exposes it", () => {
    requireSwift();
    expect(typeName(metadataFor("Swift.Bool")!)).toBe("Swift.Bool");
  });
});
