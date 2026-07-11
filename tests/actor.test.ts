import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, ClassMetadata, enumerateClassFields } from "../src/index.js";

function classType(name: string): ClassType {
  return Swift.typeOf(Swift.metadataFor(name)!) as ClassType;
}

const HEAP_OBJECT_WORDS = 2;
const DEFAULT_ACTOR_PRIVATE_WORDS = 12;
const DEFAULT_ACTOR_STORAGE_END = (HEAP_OBJECT_WORDS + DEFAULT_ACTOR_PRIVATE_WORDS) * Process.pointerSize;

describe("actor identification", () => {
  test("a plain actor is an actor and a default actor", () => {
    requireSwift();
    loadFixture();
    const t = classType("fixture.Ticker");
    expect(t.isActor).toBe(true);
    expect(t.isDefaultActor).toBe(true);
  });

  test("a distributed actor is an actor", () => {
    requireSwift();
    loadFixture();
    expect(classType("fixture.Calculator").isActor).toBe(true);
  });

  test("a regular class is neither", () => {
    requireSwift();
    loadFixture();
    const t = classType("fixture.Box");
    expect(t.isActor).toBe(false);
    expect(t.isDefaultActor).toBe(false);
  });

  test("a default actor's stored fields sit past its hidden actor storage", () => {
    requireSwift();
    loadFixture();
    const md = new ClassMetadata(Swift.metadataFor("fixture.Ticker")!.handle);
    const count = [...enumerateClassFields(md)].find((f) => f.field.name === "count");
    expect(count).toBeDefined();
    expect(count!.offset).toBeGreaterThanOrEqual(DEFAULT_ACTOR_STORAGE_END);
  });
});
