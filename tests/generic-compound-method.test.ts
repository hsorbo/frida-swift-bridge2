import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, ValueInstance } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function box() {
  return (Swift.typeOf(Swift.metadataFor("fixture.Box")!) as ClassType).init();
}

function fixtureAddress(swiftName: string): NativePointer {
  const mod = loadFixture();
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

describe("compound generic-using exprs in generic methods", () => {
  test("T? argument and return pass indirectly (Optional payload is address-only)", () => {
    loadFixture();
    const Int = Swift.metadataFor("Swift.Int")!;
    const roundOpt = box().method("roundOpt", { typeArguments: [Int] });
    expect(roundOpt.call({ some: 9 })).toEqual({ some: 9 });
    expect(roundOpt.call("none")).toBe("none");
  });

  test("T? round-trips a non-POD payload through the indirect path", () => {
    loadFixture();
    const Str = Swift.metadataFor("Swift.String")!;
    expect(box().method("roundOpt", { typeArguments: [Str] }).call({ some: "hi" })).toEqual({ some: "hi" });
  });

  test("[T] is a fixed-layout Array passed/returned directly", () => {
    loadFixture();
    const Int = Swift.metadataFor("Swift.Int")!;
    const ArrInt = Swift.metadataFor("Swift.Array", [Int])!;

    // [T]-return planning binds and calls through GenericBoundMethod.
    const hi = box().method("tripled", { typeArguments: [Int] }).call(7);
    expect(hi !== null && typeof hi === "object").toBe(true);

    // ABI proof, decode-free: tripled<Int>(7) returns [7,7,7] direct, firstGeneric<Int> reads xs[0].
    const tripled = makeSwiftNativeFunction(
      fixtureAddress("fixture.Box.tripled"),
      ArrInt,
      [{ genericParam: 0 }],
      { hasSelf: true, typeArguments: [Int] }
    );
    const firstGeneric = makeSwiftNativeFunction(
      fixtureAddress("fixture.firstGeneric"),
      { genericParam: 0 },
      [ArrInt],
      { typeArguments: [Int] }
    );
    const seven = Memory.alloc(8);
    seven.writeS64(7);
    const arrPtr = tripled(box().handle, seven)!;
    expect(firstGeneric(arrPtr)!.readS64().toNumber()).toBe(7);

    // The Array is opaque to the JS writers; as a ValueInstance it byte-copies through a high-level .call() arg.
    const arr = ValueInstance.fromCopy(ArrInt, arrPtr);
    expect(box().method("sumInts").call(arr)).toBe(21);
  });
});
