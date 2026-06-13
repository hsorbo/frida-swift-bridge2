const DISCRIMINATOR_OFFSET = 15;
const IS_SMALL = 0x20;
const IS_FOREIGN = 0x10;
const SMALL_COUNT_MASK = 0x0f;

const TAIL_ALLOCATED_OFFSET = 7;
const IS_TAIL_ALLOCATED = 0x10;
const LARGE_ADDRESS_MASK = "0x0fffffffffffffff";
const NATIVE_BIAS = 32;
const SHARED_STORAGE_START = 24;

export function readString(address: NativePointer): string | null {
  const discriminator = address.add(DISCRIMINATOR_OFFSET).readU8();

  if ((discriminator & IS_SMALL) !== 0) {
    return address.readUtf8String(discriminator & SMALL_COUNT_MASK);
  }
  if ((discriminator & IS_FOREIGN) !== 0) {
    return null;
  }

  const count = address.readU32();
  const largeAddress = address.add(8).readPointer().and(ptr(LARGE_ADDRESS_MASK));
  const tailAllocated = (address.add(TAIL_ALLOCATED_OFFSET).readU8() & IS_TAIL_ALLOCATED) !== 0;
  const start = tailAllocated
    ? largeAddress.add(NATIVE_BIAS)
    : largeAddress.add(SHARED_STORAGE_START).readPointer();
  return start.readUtf8String(count);
}
