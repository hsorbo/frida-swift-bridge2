import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance, Metadata, ClassInstance } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function constrainedBox(typeArg: Metadata, value: { [k: string]: number } | number): ValueInstance {
  return ValueInstance.fromJS(Swift.metadataFor("fixture.ConstrainedBox", [typeArg])!, { value });
}

function holder(n: number): ClassInstance {
  const mod = loadFixture();
  const Int = Swift.metadataFor("Swift.Int")!;
  const Holder = Swift.metadataFor("fixture.GenericHolder", [Int])!;
  const fn = [...mod.enumerateExports()].find((e) => Swift.demangle(e.name)?.includes("fixture.makeHolder"))!;
  const cell = Memory.alloc(Process.pointerSize);
  cell.writeS64(n);
  return new ClassInstance(makeSwiftNativeFunction(fn.address, Holder, [Int])(cell)!.readPointer());
}

describe("methods on a generic value type", () => {
  beforeEach(() => { loadFixture(); });

  test("small receiver: Self metadata trails, the callee derives the (T: Scalable) witness from it", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    // 3.scaled(by: 7) = 21, dispatched through the witness the callee reads off Self metadata.
    expect(constrainedBox(Int, 3).method("scaledStored").call(7)).toBe(21);
  });

  test("large receiver: self in x20, Self metadata still the lone trailing arg", () => {
    const Wide = Swift.metadataFor("fixture.WideScalar")!;
    // (1+2+3+4+5).scaled(by: 7) = 105.
    expect(constrainedBox(Wide, { a: 1, b: 2, c: 3, d: 4, e: 5 }).method("scaledStored").call(7)).toBe(105);
  });

  test("a return of the type parameter T decodes via Self metadata's type argument", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(constrainedBox(Int, 9).method("stored").call()).toBe(9);
  });
});

describe("methods on a generic class", () => {
  test("self in x20, Self metadata + (T: Scalable) witness recovered from the object isa", () => {
    // 3.scaled(by: 7) = 21, with no trailing type args.
    expect(holder(3).method("scaledStored").call(7)).toBe(21);
  });

  test("a return of the type parameter T decodes via the concrete type argument", () => {
    expect(holder(9).method("stored").call()).toBe(9);
  });
});
