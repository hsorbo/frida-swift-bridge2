import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { loadFixture, loadFixtureSyms } from "./fixtures/load.js";

import {
  Swift,
  Protocol,
  ProtocolConformance,
  ProtocolRequirementKind,
  readProtocolRequirements,
  readAssociatedTypeNames,
  ValueInstance,
} from "../src/index.js";

describe("associated type / associated conformance resolution", () => {
  beforeEach(() => { loadFixture(); });

  test("readAssociatedTypeNames lists only associated-type requirements, in order", () => {
    const container = Protocol.find("fixture.Container")!;
    expect(readAssociatedTypeNames(container.descriptor)).toEqual(["Item"]);
  });

  test("resolves a plain associated type by name (Container.Item on IntBox)", () => {
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    expect(Swift.typeName(table.associatedType("Item"))).toBe("Swift.Int");
  });

  test("dispatches a named getter whose type is an associated type (Container.item on IntBox)", () => {
    loadFixtureSyms();
    const container = Protocol.find("fixturesyms.Container")!;
    const intBox = Swift.metadataFor("fixturesyms.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    const value = ValueInstance.fromJS(intBox, { item: 5 });
    expect(table.get(value.handle, "item")).toEqual(int64(5));
  });

  test("a stripped conformance's witness thunk is unrecoverable, so the named getter throws", () => {
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    const value = ValueInstance.fromJS(intBox, { item: 5 });
    expect(() => table.get(value.handle, "item")).toThrow(/no getter/);
  });

  test("unknown associated type name throws", () => {
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    expect(() => table.associatedType("Bogus")).toThrow(/no associated type/);
  });

  test("resolves an associated conformance and dispatches through the nested witness table (ConstrainedContainer.Item: Scalable on ScalableBox)", () => {
    loadFixtureSyms();
    const constrained = Protocol.find("fixturesyms.ConstrainedContainer")!;
    const scalableBox = Swift.metadataFor("fixturesyms.ScalableBox")!;
    const table = constrained.conformanceFor(scalableBox)!;

    const itemType = table.associatedType("Item");
    expect(Swift.typeName(itemType)).toBe("fixturesyms.WideScalar");

    const requirement = readProtocolRequirements(constrained.descriptor).find(
      (r) => r.kind === ProtocolRequirementKind.AssociatedConformanceAccessFunction
    )!;
    const nested = table.associatedConformance(itemType, requirement);

    const scalable = Protocol.find("fixturesyms.Scalable")!;
    expect(
      new ProtocolConformance(nested.conformanceDescriptor).protocol!.handle.equals(
        scalable.descriptor.handle
      )
    ).toBe(true);

    const item = ValueInstance.fromJS(itemType, { a: 2, b: 3, c: 5, d: 7, e: 11 });
    // (2+3+5+7+11) * 3 = 84
    expect(nested.method(item.handle, "scaled").call(3)).toEqual(int64(84));
  });
});
