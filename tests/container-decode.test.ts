import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Value, StructType } from "../src/index.js";

function bag(): StructType {
  return Swift.typeOf(Swift.metadataFor("fixture.Bag")!) as StructType;
}

function decoded(method: string): Value {
  const result = bag().call(method);
  expect(result instanceof Value).toBe(true);
  return result as Value;
}

describe("bridged container decode", () => {
  test("Array<Int> projects to a JS array of numbers", ({ skip }) => {
    loadFixture(skip);
    using arr = decoded("ints");
    expect(arr.container()).toEqual([10, 20, 30]);
  });

  test("Array<String> recurses into element decode", ({ skip }) => {
    loadFixture(skip);
    using arr = decoded("strings");
    expect(arr.container()).toEqual(["a", "bb", "ccc"]);
  });

  test("empty Array decodes to []", ({ skip }) => {
    loadFixture(skip);
    using arr = decoded("empty");
    expect(arr.container()).toEqual([]);
  });

  test("Set<Int> projects to its elements", ({ skip }) => {
    loadFixture(skip);
    using set = decoded("intSet");
    const elements = (set.container() as number[]).slice().sort((a, b) => a - b);
    expect(elements).toEqual([1, 2, 3]);
  });

  test("Dictionary<Int, Int> projects to key/value entries", ({ skip }) => {
    loadFixture(skip);
    using map = decoded("intMap");
    const entries = (map.container() as { key: number; value: number }[])
      .slice()
      .sort((a, b) => a.key - b.key);
    expect(entries).toEqual([
      { key: 1, value: 100 },
      { key: 2, value: 200 },
    ]);
  });
});
