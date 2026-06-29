import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance } from "../src/index.js";

function box(typeName: string, fields: { [k: string]: number }): ValueInstance {
  return ValueInstance.fromJS(Swift.metadataFor(typeName)!, fields);
}

describe("generic methods on value receivers", () => {
  test("small loadable receiver: generic arg/return with self as a trailing exploded arg", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(box("fixture.SmallGenericBox", { base: 5 }).method("echo", { typeArguments: [Int] }).call(7)).toBe(7);
  });

  test("small receiver: a String generic argument routes through the value self", ({ skip }) => {
    loadFixture(skip);
    const Str = Swift.metadataFor("Swift.String")!;
    expect(box("fixture.SmallGenericBox", { base: 1 }).method("echo", { typeArguments: [Str] }).call("hi")).toBe("hi");
  });

  test("small receiver: self + generic arg + witness combine (trailing-self ordering)", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    // base 10 + 3.scaled(by: 7) = 31; a wrong self/metadata order corrupts base or the witness call.
    expect(box("fixture.SmallGenericBox", { base: 10 }).method("scaledBy", { typeArguments: [Int] }).call(3, 7)).toBe(31);
  });

  test("large receiver: self passed indirectly in x20 alongside trailing metadata", ({ skip }) => {
    loadFixture(skip);
    const Int = Swift.metadataFor("Swift.Int")!;
    // a..e sum 15 + 3.scaled(by: 7) = 36.
    expect(
      box("fixture.BigGenericBox", { a: 1, b: 2, c: 3, d: 4, e: 5 }).method("scaledBy", { typeArguments: [Int] }).call(3, 7)
    ).toBe(36);
  });
});
