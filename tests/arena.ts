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
