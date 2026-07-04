import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, Protocol, readProtocolRequirements, ProtocolRequirementKind } from "../src/index.js";

describe("WitnessTable.originOf", () => {
  test("describe() is default for DefaultDescriber, overridden for CustomDescriber", () => {
    loadFixture();
    const labeled = Protocol.find("fixture.Labeled")!;
    const describeReq = readProtocolRequirements(labeled.descriptor).find(
      (r) => r.kind === ProtocolRequirementKind.Method
    )!;

    const defaultTable = labeled.conformanceFor(Swift.metadataFor("fixture.DefaultDescriber")!)!;
    const customTable = labeled.conformanceFor(Swift.metadataFor("fixture.CustomDescriber")!)!;

    const defaultOrigin = defaultTable.originOf(describeReq);
    expect(defaultOrigin.kind).toBe("default");
    expect(defaultOrigin.kind === "default" && defaultOrigin.symbol.includes("Labeled.describe")).toBe(true);

    const customOrigin = customTable.originOf(describeReq);
    expect(customOrigin.kind).toBe("override");
    expect(customOrigin.kind === "override" && customOrigin.symbol.includes("CustomDescriber.describe")).toBe(true);
  });

  test("displayName has no default at all, so both conformers report override", () => {
    loadFixture();
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
    loadFixture();
    const greeter = Protocol.find("fixture.Greeter")!;
    const greetReq = readProtocolRequirements(greeter.descriptor)[0];
    const table = greeter.conformanceFor(Swift.metadataFor("fixture.PoliteGreeter")!)!;

    const origin = table.originOf(greetReq);
    expect(origin.kind).toBe("override");
    expect(origin.kind === "override" && origin.symbol.includes("PoliteGreeter.greet")).toBe(true);
  });
});
