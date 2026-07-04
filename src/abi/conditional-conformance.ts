import { resolveTypeByMangledName } from "./field-descriptor.js";
import { Metadata } from "./metadata.js";
import { ProtocolConformance } from "./protocol-conformance.js";
import { ContextDescriptor } from "./context-descriptor.js";
import { GenericRequirementKind } from "./generic-requirement-descriptor.js";
import { WitnessTable } from "./witness-table.js";

export interface ConditionalRequirement {
  kind: GenericRequirementKind;
  subject: Metadata;
  protocol: ContextDescriptor | null;
  sameType: Metadata | null;
}

export function resolveConditionalRequirements(table: WitnessTable): ConditionalRequirement[] {
  const conformance = new ProtocolConformance(table.conformanceDescriptor);
  const description = table.conformingType.description;
  const genericArguments = description.isGeneric ? table.conformingType.genericArguments : null;

  return conformance.conditionalRequirements.map((entry) => {
    const subject = resolveTypeByMangledName(entry.param, description, genericArguments);
    if (subject === null) {
      throw new Error("failed to resolve conditional requirement's subject type");
    }
    const sameType = entry.sameTypeName === null
      ? null
      : resolveTypeByMangledName(entry.sameTypeName, description, genericArguments);
    return {
      kind: entry.kind,
      subject,
      protocol: entry.protocol,
      sameType,
    };
  });
}
