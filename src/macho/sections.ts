import { getMachOApi } from "../runtime/api.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

const SWIFT_SEGMENT = "__TEXT";

const TYPE_REFERENCE_KIND_MASK = 0x3;
const DIRECT_TYPE_DESCRIPTOR = 0x0;
const INDIRECT_TYPE_DESCRIPTOR = 0x1;

export interface SwiftSection {
  address: NativePointer;
  size: number;
}

export function getSwiftSection(module: Module, name: string): SwiftSection | null {
  const segNamePtr = Memory.allocUtf8String(SWIFT_SEGMENT);
  const sectNamePtr = Memory.allocUtf8String(name);
  const sizeOut = Memory.alloc(Process.pointerSize);

  const address = getMachOApi().getsectiondata(module.base, segNamePtr, sectNamePtr, sizeOut);
  const size = sizeOut.readU32();

  return size === 0 ? null : { address, size };
}

export function* enumerateTypeContextDescriptors(module: Module): Generator<NativePointer> {
  const section = getSwiftSection(module, "__swift5_types");
  if (section === null) {
    return;
  }

  const count = section.size / RelativeDirectPointer.sizeOf;
  for (let i = 0; i < count; i++) {
    const record = section.address.add(i * RelativeDirectPointer.sizeOf);
    const descriptor = resolveTypeMetadataRecord(record);
    if (descriptor !== null) {
      yield descriptor;
    }
  }
}

function resolveTypeMetadataRecord(record: NativePointer): NativePointer | null {
  const raw = record.readS32();
  const offset = raw & ~TYPE_REFERENCE_KIND_MASK;
  if (offset === 0) {
    return null;
  }
  const direct = record.add(offset);
  switch (raw & TYPE_REFERENCE_KIND_MASK) {
    case DIRECT_TYPE_DESCRIPTOR:
      return direct;
    case INDIRECT_TYPE_DESCRIPTOR:
      return direct.readPointer().strip();
    default:
      return null;
  }
}
