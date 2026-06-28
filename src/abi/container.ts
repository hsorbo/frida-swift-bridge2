import { Metadata } from "./metadata.js";
import { readValue, SwiftValue } from "./instance.js";

// Unlike the rest of the bridge, this walks private stdlib storage layout (__ContiguousArrayStorage,
// __Raw{Set,Dictionary}Storage, the hash-table occupancy bitmap), not the stable ABI: a future Swift
// could shift an offset and silently mis-decode. Kept off the readValue path and behind an explicit
// Value.container() call so the ABI-pure core never depends on it. If this drifts, the robust rewrite
// is to decode via the container's own count + subscript through the generic-method machinery, since
// the calling convention is part of the stable ABI.

// arm64 SWIFT_ABI_ARM64_SWIFT_SPARE_BITS_MASK: clearing the spare bits of a BridgeObject yields the
// native storage pointer; the is-objc bit instead marks an unwalkable Cocoa-bridged backing.
const BRIDGE_OBJECT_NATIVE_MASK = ptr("0x0ffffffffffffff8");
const BRIDGE_OBJECT_IS_OBJC_BIT = ptr("0x4000000000000000");

const HEAP_HEADER_SIZE = 0x10;

const ARRAY_COUNT_OFFSET = HEAP_HEADER_SIZE;
const ARRAY_FIRST_ELEMENT_OFFSET = 0x20;

const HASH_STORAGE_COUNT_OFFSET = HEAP_HEADER_SIZE;
const HASH_STORAGE_SCALE_OFFSET = 0x20;
const SET_RAW_ELEMENTS_OFFSET = 0x30;
const SET_BITMAP_OFFSET = 0x38;
const DICT_RAW_KEYS_OFFSET = 0x30;
const DICT_RAW_VALUES_OFFSET = 0x38;
const DICT_BITMAP_OFFSET = 0x40;

const BITS_PER_WORD = 64;

export type ContainerEntry = { key: SwiftValue; value: SwiftValue };

// A container whose bridge object is NSArray/NSDictionary-backed: the Swift bridge does not walk
// foreign Cocoa storage, it hands back the object pointer for the caller to wrap with ObjC.Object.
export type ObjcBackedContainer = { objcBacked: NativePointer };

export function decodeBridgedContainer(
  metadata: Metadata,
  address: NativePointer
): { value: SwiftValue } | null {
  const typeName = metadata.description.fullTypeName;
  if (typeName !== "Swift.Array" && typeName !== "Swift.Set" && typeName !== "Swift.Dictionary") {
    return null;
  }
  const bridge = address.readPointer();
  const storage = bridge.and(BRIDGE_OBJECT_NATIVE_MASK);
  if (!bridge.and(BRIDGE_OBJECT_IS_OBJC_BIT).isNull()) {
    return { value: { objcBacked: storage } };
  }
  switch (typeName) {
    case "Swift.Array":
      return { value: decodeArray(metadata, storage) };
    case "Swift.Set":
      return { value: decodeSet(metadata, storage) };
    default:
      return { value: decodeDictionary(metadata, storage) };
  }
}

function decodeArray(metadata: Metadata, storage: NativePointer): SwiftValue[] {
  const count = storage.add(ARRAY_COUNT_OFFSET).readS64().toNumber();
  if (count === 0) {
    return [];
  }
  const element = typeArgument(metadata, 0);
  const stride = element.typeLayout.stride;
  const base = storage.add(alignUp(ARRAY_FIRST_ELEMENT_OFFSET, element.typeLayout.alignment));
  const out: SwiftValue[] = [];
  for (let i = 0; i < count; i++) {
    out.push(projectElement(element, base.add(i * stride)));
  }
  return out;
}

function decodeSet(metadata: Metadata, storage: NativePointer): SwiftValue[] {
  const count = storage.add(HASH_STORAGE_COUNT_OFFSET).readS64().toNumber();
  if (count === 0) {
    return [];
  }
  const element = typeArgument(metadata, 0);
  const stride = element.typeLayout.stride;
  const elements = storage.add(SET_RAW_ELEMENTS_OFFSET).readPointer();
  const bitmap = storage.add(SET_BITMAP_OFFSET);
  const out: SwiftValue[] = [];
  for (const bucket of occupiedBuckets(bitmap, scaleOf(storage), count)) {
    out.push(projectElement(element, elements.add(bucket * stride)));
  }
  return out;
}

function decodeDictionary(metadata: Metadata, storage: NativePointer): ContainerEntry[] {
  const count = storage.add(HASH_STORAGE_COUNT_OFFSET).readS64().toNumber();
  if (count === 0) {
    return [];
  }
  const key = typeArgument(metadata, 0);
  const value = typeArgument(metadata, 1);
  const keyStride = key.typeLayout.stride;
  const valueStride = value.typeLayout.stride;
  const keys = storage.add(DICT_RAW_KEYS_OFFSET).readPointer();
  const values = storage.add(DICT_RAW_VALUES_OFFSET).readPointer();
  const bitmap = storage.add(DICT_BITMAP_OFFSET);
  const out: ContainerEntry[] = [];
  for (const bucket of occupiedBuckets(bitmap, scaleOf(storage), count)) {
    out.push({
      key: projectElement(key, keys.add(bucket * keyStride)),
      value: projectElement(value, values.add(bucket * valueStride)),
    });
  }
  return out;
}

function projectElement(metadata: Metadata, address: NativePointer): SwiftValue {
  const container = decodeBridgedContainer(metadata, address);
  return container !== null ? container.value : readValue(metadata, address);
}

function typeArgument(metadata: Metadata, index: number): Metadata {
  return new Metadata(
    metadata.genericArguments.add(index * Process.pointerSize).readPointer()
  );
}

function scaleOf(storage: NativePointer): number {
  return storage.add(HASH_STORAGE_SCALE_OFFSET).readS8();
}

function* occupiedBuckets(
  bitmap: NativePointer,
  scale: number,
  count: number
): Generator<number> {
  const bucketCount = 1 << scale;
  let seen = 0;
  for (let bucket = 0; bucket < bucketCount && seen < count; bucket++) {
    const word = (bucket / BITS_PER_WORD) | 0;
    const bit = bucket % BITS_PER_WORD;
    const half = bit < 32 ? bitmap.add(word * 8) : bitmap.add(word * 8 + 4);
    if (((half.readU32() >>> (bit & 31)) & 1) !== 0) {
      seen++;
      yield bucket;
    }
  }
}

function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}
