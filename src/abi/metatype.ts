import { Metadata } from "./metadata.js";

const OFFSETOF_INSTANCE_TYPE = Process.pointerSize;

export function metatypeInstanceType(metadata: Metadata): Metadata {
  return new Metadata(metadata.handle.add(OFFSETOF_INSTANCE_TYPE).readPointer());
}
