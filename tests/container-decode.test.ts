import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, StructType, SwiftObject } from "../src/index.js";

function bag(): StructType {
  return Swift.typeOf(Swift.metadataFor("fixture.Bag")!) as StructType;
}

function decoded(method: string): SwiftObject {
  const result = bag().call(method) as SwiftObject;
  expect(result.$kind).toBe("value");
  return result;
}

describe("bridged container decode", () => {
  test("Array<Int> projects to a JS array of numbers", () => {
    loadFixture();
    using arr = decoded("ints");
    expect(arr.$container()).toEqual([10, 20, 30]);
  });

  test("Array<String> recurses into element decode", () => {
    loadFixture();
    using arr = decoded("strings");
    expect(arr.$container()).toEqual(["a", "bb", "ccc"]);
  });

  test("empty Array decodes to []", () => {
    loadFixture();
    using arr = decoded("empty");
    expect(arr.$container()).toEqual([]);
  });

  test("Set<Int> projects to its elements", () => {
    loadFixture();
    using set = decoded("intSet");
    const elements = (set.$container() as number[]).slice().sort((a, b) => a - b);
    expect(elements).toEqual([1, 2, 3]);
  });

  test("Dictionary<Int, Int> projects to key/value entries", () => {
    loadFixture();
    using map = decoded("intMap");
    const entries = (map.$container() as { key: number; value: number }[])
      .slice()
      .sort((a, b) => a.key - b.key);
    expect(entries).toEqual([
      { key: 1, value: 100 },
      { key: 2, value: 200 },
    ]);
  });
});
