import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, AsyncFunctionPointer, driveAsyncCall } from "../src/index.js";

const GA_FREE_ASYNC_AFP = "$s7fixture11gaFreeAsyncyS2iYaFTu";

function gaHolder(v: number) {
  return (Swift.typeOf(Swift.metadataFor("fixture.GAHolder")!) as ClassType).init(v);
}

function wholeGAHolder(v: number) {
  return (Swift.typeOf(Swift.metadataFor("fixture.WholeGAHolder")!) as ClassType).init(v);
}

// A generic global actor's executor is its default-actor singleton, drained by the cooperative pool;
// the async body hops there itself, so these need no InitialSerialExecutor and don't touch the main queue.
describe("generic global-actor async calling", () => {
  beforeEach(() => {
    loadFixture();
  });

  test("drives a @globalActor-isolated free function: gaFreeAsync(41) ⇒ 42", () => {
    const afp = new AsyncFunctionPointer(loadFixture().getExportByName(GA_FREE_ASYNC_AFP).strip());
    expect(Number(driveAsyncCall(afp, [ptr(41)]).readS64())).toBe(42);
  });

  test("a @globalActor-isolated method on a plain class is neither actor nor default actor", () => {
    const t = Swift.typeOf(Swift.metadataFor("fixture.GAHolder")!) as ClassType;
    expect(t.isActor).toBe(false);
    expect(t.isDefaultActor).toBe(false);
  });

  test("drives a @globalActor-isolated method on a plain class: gaMethodAsync(1) ⇒ 11", async () => {
    expect(await gaHolder(10).gaMethodAsync(1)).toBe(11);
  });

  test("a @globalActor-isolated method mutates instance state across calls", async () => {
    const h = gaHolder(10);
    expect(await h.gaMethodAsync(1)).toBe(11);
    expect(await h.gaMethodAsync(2)).toBe(13);
  });

  test("drives a method on a whole-type @globalActor-isolated class: bumpAsync(1) ⇒ 11", async () => {
    expect(await wholeGAHolder(10).bumpAsync(1)).toBe(11);
  });

  test("serializes concurrent calls on a global actor: 20 × gaMethodAsync(1)", async () => {
    const h = gaHolder(0);
    const results = await Promise.all(Array.from({ length: 20 }, () => h.gaMethodAsync(1)));
    expect(new Set(results)).toEqual(new Set(Array.from({ length: 20 }, (_, i) => i + 1)));
  });
});
