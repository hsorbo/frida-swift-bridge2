import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Protocol, readProtocolRequirements, ProtocolRequirementKind } from "../src/index.js";

describe("WitnessTable.originOf", () => {
  beforeEach(() => { loadFixture(); });

  test("describe() is default for DefaultDescriber, overridden for CustomDescriber", () => {
    const labeled = Protocol.find("fixture.Labeled")!;
    const describeReq = readProtocolRequirements(labeled.descriptor).find(
      (r) => r.kind === ProtocolRequirementKind.Method
    )!;

    const defaultTable = labeled.conformanceFor(Swift.metadataFor("fixture.DefaultDescriber")!)!;
    const customTable = labeled.conformanceFor(Swift.metadataFor("fixture.CustomDescriber")!)!;

    const defaultOrigin = defaultTable.originOf(describeReq);
    expect(defaultOrigin.kind).toBe("default");
    expect(defaultOrigin.kind === "default" && defaultOrigin.symbol.includes("Labeled.describe")).toBe(true);
    expect(defaultOrigin.kind !== "unknown" && defaultOrigin.dispatch).toBe("direct");

    const customOrigin = customTable.originOf(describeReq);
    expect(customOrigin.kind).toBe("override");
    expect(customOrigin.kind === "override" && customOrigin.symbol.includes("CustomDescriber.describe")).toBe(true);
    expect(customOrigin.kind !== "unknown" && customOrigin.dispatch).toBe("direct");
  });

  test("displayName has no default at all, so both conformers report override", () => {
    const labeled = Protocol.find("fixture.Labeled")!;
    const nameReq = readProtocolRequirements(labeled.descriptor).find(
      (r) => r.kind === ProtocolRequirementKind.Getter
    )!;

    const defaultTable = labeled.conformanceFor(Swift.metadataFor("fixture.DefaultDescriber")!)!;
    const customTable = labeled.conformanceFor(Swift.metadataFor("fixture.CustomDescriber")!)!;

    expect(defaultTable.originOf(nameReq).kind).toBe("override");
    expect(customTable.originOf(nameReq).kind).toBe("override");
  });

  test("a protocol with no defaults anywhere still classifies as override", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const greetReq = readProtocolRequirements(greeter.descriptor)[0];
    const table = greeter.conformanceFor(Swift.metadataFor("fixture.PoliteGreeter")!)!;

    const origin = table.originOf(greetReq);
    expect(origin.kind).toBe("override");
    expect(origin.kind === "override" && origin.symbol.includes("PoliteGreeter.greet")).toBe(true);
    expect(origin.kind !== "unknown" && origin.dispatch).toBe("direct");
  });
});

describe("WitnessTable.originOf — vtable-dispatched (overridable class) requirements", () => {
  beforeEach(() => { loadFixture(); });

  test("non-AnyObject-constrained conformance: override via vtable", () => {
    const vocal = Protocol.find("fixture.Vocal")!;
    const speakReq = readProtocolRequirements(vocal.descriptor)[0];
    const table = vocal.conformanceFor(Swift.metadataFor("fixture.BaseSpeaker")!)!;

    const origin = table.originOf(speakReq);
    expect(origin.kind).toBe("override");
    expect(origin.kind !== "unknown" && origin.dispatch).toBe("vtable");
    expect(origin.kind === "override" && origin.symbol.includes("BaseSpeaker.speak")).toBe(true);
  });

  test("AnyObject-constrained conformance: override via vtable", () => {
    const squawker = Protocol.find("fixture.Squawker")!;
    const squawkReq = readProtocolRequirements(squawker.descriptor)[0];
    const table = squawker.conformanceFor(Swift.metadataFor("fixture.BaseSquawker")!)!;

    const origin = table.originOf(squawkReq);
    expect(origin.kind).toBe("override");
    expect(origin.kind !== "unknown" && origin.dispatch).toBe("vtable");
    expect(origin.kind === "override" && origin.symbol.includes("BaseSquawker.squawk")).toBe(true);
  });

  test("a subclass reusing its ancestor's conformance resolves its own live override, not the ancestor's", () => {
    const vocal = Protocol.find("fixture.Vocal")!;
    const speakReq = readProtocolRequirements(vocal.descriptor)[0];
    const table = vocal.conformanceFor(Swift.metadataFor("fixture.SubSpeaker")!)!;

    const origin = table.originOf(speakReq);
    expect(origin.kind).toBe("override");
    expect(origin.kind !== "unknown" && origin.dispatch).toBe("vtable");
    expect(origin.kind === "override" && origin.symbol.includes("SubSpeaker.speak")).toBe(true);
  });
});
