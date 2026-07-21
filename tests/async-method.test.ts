import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, ValueType, ValueInstance, BoundAsyncMethod, GenericBoundAsyncMethod, SwiftAsyncThrow } from "../src/index.js";

function calc(base: number) {
  return (Swift.typeOf(Swift.metadataFor("fixture.AsyncCalc")!) as ClassType).init(base);
}

describe("async method", () => {
  beforeEach(() => { loadFixture(); });

  test("awaits an async method through the facade: calc(100).addAsync(5) ⇒ 105", async () => {
    expect(await calc(100).addAsync(5)).toEqual(int64(105));
  });

  test("$method hands back a BoundAsyncMethod", async () => {
    const m = calc(100).$method("addAsync");
    expect(m instanceof BoundAsyncMethod).toBeTruthy();
    expect(await (m as BoundAsyncMethod).call(5)).toEqual(int64(105));
  });

  test("resolves an async throwing method that does not throw", async () => {
    expect(await calc(100).divideBaseBy(2)).toEqual(int64(50));
  });

  test("rejects with SwiftAsyncThrow when the async throwing method throws", async () => {
    await expect(calc(100).divideBaseBy(0)).rejects.toThrow(SwiftAsyncThrow);
  });

  test("passes and returns a Double: calc(100).scaleAsync(1.5) ⇒ 150", async () => {
    expect(await calc(100).scaleAsync(1.5)).toBe(150);
  });

  test("returns a large struct through an @out buffer: calc(100).quadAsync()", async () => {
    const q = (await calc(100).quadAsync()) as { a: number; b: number; c: number; d: number; e: number };
    expect(q.a).toEqual(int64(100));
    expect(q.e).toEqual(int64(104));
  });

  test("$method hands back a GenericBoundAsyncMethod for an async generic method", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(calc(100).$method("echoAsync", { typeArguments: [Int] }) instanceof GenericBoundAsyncMethod).toBeTruthy();
  });

  test("drives an async generic method (metadata only): echoAsync<Int>(21) ⇒ 21", async () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(await calc(100).$method("echoAsync", { typeArguments: [Int] }).call(21)).toEqual(int64(21));
  });

  test("round-trips a non-POD generic argument: echoAsync<String>(\"hi\") ⇒ \"hi\"", async () => {
    const Str = Swift.metadataFor("Swift.String")!;
    expect(await calc(100).$method("echoAsync", { typeArguments: [Str] }).call("hi")).toBe("hi");
  });

  test("passes a witness table for a constrained generic: pickLargerAsync<Int>(3, 8) ⇒ 8", async () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    expect(await calc(100).$method("pickLargerAsync", { typeArguments: [Int] }).call(3, 8)).toEqual(int64(8));
  });

  test("async method on a small loadable value type trails self after the args: Accumulator.peekAsync(10) ⇒ 15", async () => {
    const acc = ValueInstance.fromJS(Swift.metadataFor("fixture.Accumulator")!, { total: 5 });
    expect(await acc.call("peekAsync", 10)).toEqual(int64(15));
  });

  test("static async method on a value type (no self): Accumulator.sumStaticAsync(4, 5) ⇒ 9", async () => {
    const t = Swift.typeOf(Swift.metadataFor("fixture.Accumulator")!) as ValueType;
    expect(await t.call("sumStaticAsync", 4, 5)).toEqual(int64(9));
  });

  test("static async method on a class: AsyncCalc.combineAsync(3, 4) ⇒ 34", async () => {
    const t = Swift.typeOf(Swift.metadataFor("fixture.AsyncCalc")!) as ClassType;
    expect(await t.call("combineAsync", 3, 4)).toEqual(int64(34));
  });
});
