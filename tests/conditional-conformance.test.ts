import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import {
  Swift,
  Protocol,
  GenericRequirementKind,
  readRequirementSignature,
} from "../src/index.js";

describe("conditional conformance / requirement-signature introspection", () => {
  beforeEach(() => { loadFixture(); });

  test("Pair<PoliteGreeter>: Greeter where T: Greeter — decodes and resolves the conditional requirement", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const pairOfGreeters = Swift.metadataFor("fixture.Pair", [Swift.metadataFor("fixture.PoliteGreeter")!])!;
    const table = greeter.conformanceFor(pairOfGreeters)!;

    const reqs = table.conditionalRequirements;
    expect(reqs.length).toBe(1);
    expect(reqs[0].kind).toBe(GenericRequirementKind.Protocol);
    expect(reqs[0].protocol!.fullTypeName).toBe("fixture.Greeter");
    expect(Swift.typeName(reqs[0].subject)).toBe("fixture.PoliteGreeter");
  });

  test("Pair<Swift.Int>: Greeter fails — Int doesn't conform to Greeter, so there is no witness table to introspect", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const pairOfInts = Swift.metadataFor("fixture.Pair", [Swift.metadataFor("Swift.Int")!])!;
    expect(greeter.conformanceFor(pairOfInts)).toBeNull();
  });

  test("an unconditional conformance has zero conditional requirements", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const politeGreeter = Swift.metadataFor("fixture.PoliteGreeter")!;
    const table = greeter.conformanceFor(politeGreeter)!;
    expect(table.conditionalRequirements).toEqual([]);
  });

  test("readRequirementSignature decodes ConstrainedContainer's associatedtype Item: Scalable constraint", () => {
    const constrained = Protocol.find("fixture.ConstrainedContainer")!;
    const signature = readRequirementSignature(constrained.descriptor);
    expect(signature.length).toBe(1);
    expect(signature[0].kind).toBe(GenericRequirementKind.Protocol);
    expect(signature[0].protocol!.fullTypeName).toBe("fixture.Scalable");
  });
});
