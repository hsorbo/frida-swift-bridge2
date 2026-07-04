import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

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
  test("readAssociatedTypeNames lists only associated-type requirements, in order", () => {
    loadFixture();
    const container = Protocol.find("fixture.Container")!;
    expect(readAssociatedTypeNames(container.descriptor)).toEqual(["Item"]);
  });

  test("resolves a plain associated type by name (Container.Item on IntBox)", () => {
    loadFixture();
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    expect(Swift.typeName(table.associatedType("Item"))).toBe("Swift.Int");
  });

  test("dispatches a named getter whose type is an associated type (Container.item on IntBox)", () => {
    loadFixture();
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    const value = ValueInstance.fromJS(intBox, { item: 5 });
    expect(table.get(value.handle, "item")).toBe(5);
  });

  test("unknown associated type name throws", () => {
    loadFixture();
    const container = Protocol.find("fixture.Container")!;
    const intBox = Swift.metadataFor("fixture.IntBox")!;
    const table = container.conformanceFor(intBox)!;
    expect(() => table.associatedType("Bogus")).toThrow(/no associated type/);
  });

  test("resolves an associated conformance and dispatches through the nested witness table (ConstrainedContainer.Item: Scalable on ScalableBox)", () => {
    loadFixture();
    const constrained = Protocol.find("fixture.ConstrainedContainer")!;
    const scalableBox = Swift.metadataFor("fixture.ScalableBox")!;
    const table = constrained.conformanceFor(scalableBox)!;

    const itemType = table.associatedType("Item");
    expect(Swift.typeName(itemType)).toBe("fixture.WideScalar");

    const requirement = readProtocolRequirements(constrained.descriptor).find(
      (r) => r.kind === ProtocolRequirementKind.AssociatedConformanceAccessFunction
    )!;
    const nested = table.associatedConformance(itemType, requirement);

    const scalable = Protocol.find("fixture.Scalable")!;
    expect(
      new ProtocolConformance(nested.conformanceDescriptor).protocol!.handle.equals(
        scalable.descriptor.handle
      )
    ).toBe(true);

    const item = ValueInstance.fromJS(itemType, { a: 2, b: 3, c: 5, d: 7, e: 11 });
    // (2+3+5+7+11) * 3 = 84
    expect(nested.method(item.handle, "scaled").call(3)).toBe(84);
  });
});
