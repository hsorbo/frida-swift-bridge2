import { getSwiftCoreApi } from "../runtime/api.js";
import { Metadata } from "./metadata.js";
import { ProtocolConformance } from "./protocol-conformance.js";
import {
  ProtocolRequirement,
  ProtocolRequirementKind,
  readAssociatedTypeNames,
  readProtocolRequirements,
  requirementBaseDescriptor,
} from "./protocol-descriptor.js";
import { WitnessTable } from "./witness-table.js";
import { ContextDescriptor } from "./context-descriptor.js";

function protocolOf(table: WitnessTable): ContextDescriptor {
  const protocol = new ProtocolConformance(table.conformanceDescriptor).protocol;
  if (protocol === null) {
    throw new Error("witness table's conformance descriptor has no protocol");
  }
  return protocol;
}

// MetadataRequest(state: Complete, isNonBlocking: false)
const REQUEST_BLOCKING_COMPLETE = 0;

export function resolveAssociatedType(table: WitnessTable, name: string): Metadata {
  const protocol = protocolOf(table);
  const requirements = readProtocolRequirements(protocol).filter(
    (r) => r.kind === ProtocolRequirementKind.AssociatedTypeAccessFunction
  );
  const names = readAssociatedTypeNames(protocol);
  const index = names.indexOf(name);
  if (index === -1) {
    throw new Error(`no associated type ${name} on ${protocol.fullTypeName ?? "protocol"}`);
  }
  const requirement = requirements[index];
  const [value] = getSwiftCoreApi().swift_getAssociatedTypeWitness(
    REQUEST_BLOCKING_COMPLETE,
    table.handle,
    table.conformingType.handle,
    requirementBaseDescriptor(requirement),
    requirement.address
  );
  if (value.isNull()) {
    throw new Error(`failed to resolve associated type ${name}`);
  }
  return new Metadata(value);
}

export function resolveAssociatedConformance(
  table: WitnessTable,
  associatedType: Metadata,
  requirement: ProtocolRequirement
): WitnessTable {
  if (requirement.kind !== ProtocolRequirementKind.AssociatedConformanceAccessFunction) {
    throw new Error("requirement is not an associated-conformance accessor");
  }
  const raw = getSwiftCoreApi().swift_getAssociatedConformanceWitness(
    table.handle,
    table.conformingType.handle,
    associatedType.handle,
    requirementBaseDescriptor(requirement),
    requirement.address
  );
  if (raw.isNull()) {
    throw new Error("failed to resolve associated conformance");
  }
  return new WitnessTable(raw, associatedType);
}
