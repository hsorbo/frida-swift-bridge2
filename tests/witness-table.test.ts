import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture, loadFixtureSyms } from "./fixtures/load.js";

import {
  Swift,
  Protocol,
  conformsToProtocol,
  ProtocolConformance,
  readProtocolRequirements,
  WitnessTable,
} from "../src/index.js";

describe("WitnessTable", () => {
  // The thunk symbol only survives in fixturesyms, fixture's unstripped twin.
  test("a requirement slot matches the protocol-witness-thunk symbol", () => {
    const mod = loadFixtureSyms();
    const greeter = Protocol.find("fixturesyms.Greeter")!;
    const requirement = readProtocolRequirements(greeter.descriptor)[0];

    const politeGreeter = Swift.metadataFor("fixturesyms.PoliteGreeter")!;
    const table = new WitnessTable(conformsToProtocol(politeGreeter, greeter.descriptor)!, politeGreeter);

    const thunk = [...mod.enumerateSymbols()].find((e) => {
      const d = Swift.demangle(e.name);
      return (
        d !== null &&
        d.includes("protocol witness for fixturesyms.Greeter.greet()") &&
        d.includes("PoliteGreeter")
      );
    })!;
    expect(table.requirement(requirement.witnessIndex).equals(thunk.address)).toBe(true);
  });

  test("slot 0 is the conformance descriptor, pointing back at Greeter and PoliteGreeter", () => {
    loadFixture();
    const greeter = Protocol.find("fixture.Greeter")!;
    const politeGreeter = Swift.metadataFor("fixture.PoliteGreeter")!;
    const table = new WitnessTable(conformsToProtocol(politeGreeter, greeter.descriptor)!, politeGreeter);

    const conformance = new ProtocolConformance(table.conformanceDescriptor);
    expect(conformance.protocol!.handle.equals(greeter.descriptor.handle)).toBe(true);
    expect(conformance.typeDescriptor!.equals(politeGreeter.description.handle)).toBe(true);
  });
});
