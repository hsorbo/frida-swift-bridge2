// A 32-bit relative pointer only reaches ±2GB, and Frida's `near` page search is unreliable on
// iOS once the address space fills up. Carve fake descriptors and their referent strings from one
// contiguous arena instead, so every relative offset stays trivially in range.
const ARENA_SIZE = 0x100000;
const arenas: NativePointer[] = [];
let arenaCursor = 0;

export function arenaAlloc(size: number): NativePointer {
  const aligned = (size + 7) & ~7;
  if (arenas.length === 0 || arenaCursor + aligned > ARENA_SIZE) {
    arenas.push(Memory.alloc(ARENA_SIZE));
    arenaCursor = 0;
  }
  const p = arenas[arenas.length - 1].add(arenaCursor);
  arenaCursor += aligned;
  return p;
}

export function arenaString(str: string): NativePointer {
  const buf = arenaAlloc(str.length + 1);
  buf.writeUtf8String(str);
  return buf;
}

export function writeRelativeDirectPointer(field: NativePointer, target: NativePointer): void {
  const distance = target.compare(field) >= 0 ? target.sub(field) : field.sub(target);
  if (distance.compare(0x7fffffff) > 0) {
    throw new Error("relative-pointer target out of S32 range; allocate both ends from the arena");
  }
  field.writeS32(target.sub(field).toInt32());
}
