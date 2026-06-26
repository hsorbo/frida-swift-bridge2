import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import { Swift, typeName } from "../src/index.js";

describe("typeName", () => {
  test("names a concrete stdlib type", ({ skip }) => {
    requireSwift(skip);
    expect(typeName(Swift.metadataFor("Swift.Int")!)).toBe("Swift.Int");
  });

  test("names a generic instantiation with its type arguments", ({ skip }) => {
    requireSwift(skip);
    const int = Swift.metadataFor("Swift.Int")!;
    const arrayInt = typeName(Swift.metadataFor("Swift.Array", [int])!);
    expect(arrayInt).toContain("Array");
    expect(arrayInt).toContain("Int");

    const dict = typeName(
      Swift.metadataFor("Swift.Dictionary", [Swift.metadataFor("Swift.String")!, int])!
    );
    expect(dict).toContain("Dictionary");
    expect(dict).toContain("String");
    expect(dict).toContain("Int");
  });

  test("Swift.typeName exposes it", ({ skip }) => {
    requireSwift(skip);
    expect(Swift.typeName(Swift.metadataFor("Swift.Bool")!)).toBe("Swift.Bool");
  });
});
