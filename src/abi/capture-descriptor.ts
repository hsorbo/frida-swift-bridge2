import { MangledName, resolveTypeByMangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { Metadata, MetadataKind } from "./metadata.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";

// TargetHeapLocalVariableMetadata: Kind, OffsetToFirstCapture, CaptureDescription.
const OFFSETOF_HEAP_OFFSET_TO_FIRST_CAPTURE = 0x8;
const OFFSETOF_HEAP_CAPTURE_DESCRIPTION = 0x10;

const OFFSETOF_CD_NUM_CAPTURE_TYPES = 0x0;
const OFFSETOF_CD_NUM_METADATA_SOURCES = 0x4;
const OFFSETOF_CD_NUM_BINDINGS = 0x8;
const OFFSETOF_CD_RECORDS = 0xc;

const SIZEOF_CAPTURE_TYPE_RECORD = 0x4;
const SIZEOF_METADATA_SOURCE_RECORD = 0x8;

export class CaptureTypeRecord {
  constructor(readonly handle: NativePointer) {}

  get mangledTypeName(): MangledName | null {
    const ptr = RelativeDirectPointer.resolve(this.handle);
    return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
  }
}

export class MetadataSourceRecord {
  constructor(readonly handle: NativePointer) {}

  get mangledTypeName(): MangledName | null {
    const ptr = RelativeDirectPointer.resolve(this.handle);
    return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
  }

  get mangledMetadataSource(): MangledName | null {
    const ptr = RelativeDirectPointer.resolve(this.handle.add(0x4));
    return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
  }
}

export class CaptureDescriptor {
  constructor(readonly handle: NativePointer) {}

  get numCaptureTypes(): number {
    return this.handle.add(OFFSETOF_CD_NUM_CAPTURE_TYPES).readU32();
  }

  get numMetadataSources(): number {
    return this.handle.add(OFFSETOF_CD_NUM_METADATA_SOURCES).readU32();
  }

  get numBindings(): number {
    return this.handle.add(OFFSETOF_CD_NUM_BINDINGS).readU32();
  }

  get captureTypes(): CaptureTypeRecord[] {
    const base = this.handle.add(OFFSETOF_CD_RECORDS);
    return Array.from({ length: this.numCaptureTypes }, (_, i) =>
      new CaptureTypeRecord(base.add(i * SIZEOF_CAPTURE_TYPE_RECORD))
    );
  }

  get metadataSources(): MetadataSourceRecord[] {
    const base = this.handle
      .add(OFFSETOF_CD_RECORDS)
      .add(this.numCaptureTypes * SIZEOF_CAPTURE_TYPE_RECORD);
    return Array.from({ length: this.numMetadataSources }, (_, i) =>
      new MetadataSourceRecord(base.add(i * SIZEOF_METADATA_SOURCE_RECORD))
    );
  }
}

export function captureDescriptorOf(context: NativePointer): CaptureDescriptor | null {
  if (context.isNull()) {
    return null;
  }
  const metadata = context.readPointer().strip();
  const kind = new Metadata(metadata).kind;
  if (kind !== MetadataKind.HeapLocalVariable) {
    return null;
  }
  const description = metadata.add(OFFSETOF_HEAP_CAPTURE_DESCRIPTION).readPointer();
  return description.isNull() ? null : new CaptureDescriptor(description);
}

// bindings, if any, precede the captures at this offset.
export function offsetToFirstCapture(context: NativePointer): number {
  const metadata = context.readPointer().strip();
  return metadata.add(OFFSETOF_HEAP_OFFSET_TO_FIRST_CAPTURE).readU32();
}

export function resolveCaptureType(record: CaptureTypeRecord): Metadata | null {
  const mangled = record.mangledTypeName;
  return mangled === null ? null : resolveTypeByMangledName(mangled);
}
