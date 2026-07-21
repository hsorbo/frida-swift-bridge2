import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Protocol, ProtocolRequirementKind, readProtocolRequirements } from "../src/abi.js";

describe("readProtocolRequirements", () => {
  beforeEach(() => { loadFixture(); });

  test("reads Greeter's single method requirement", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const requirements = readProtocolRequirements(greeter.descriptor);
    expect(requirements.length).toBe(1);
    expect(requirements[0].kind).toBe(ProtocolRequirementKind.Method);
    expect(requirements[0].isInstance).toBe(true);
    expect(requirements[0].witnessIndex).toBe(1);
  });

  test("throws for a non-protocol descriptor", () => {
    const greeter = Protocol.find("fixture.Greeter")!;
    const moduleDescriptor = greeter.descriptor.parent!;
    expect(() => readProtocolRequirements(moduleDescriptor)).toThrow(/not a protocol/);
  });
});
