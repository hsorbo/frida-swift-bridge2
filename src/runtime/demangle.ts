import { getSwiftCoreApi } from "./api.js";

const SWIFT_SYMBOL_PREFIXES = ["$s", "_$s", "$S", "_$S", "_T0"];

export function isSwiftSymbol(name: string): boolean {
  return SWIFT_SYMBOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const cache = new Map<string, string | null>();

let output = Memory.alloc(4096);
let outputSize = 4096;
const outputSizeCell = Memory.alloc(Process.pointerSize);

// Called without an output buffer, swift_demangle strdup()s its result and hands over ownership.
// Lending it one keeps the C side allocation-free; it then truncates a name that doesn't fit and
// writes back the size it wanted, so an outgrown buffer costs one retry.
function demangleUncached(mangled: string): string | null {
  const namePtr = Memory.allocUtf8String(mangled);
  const api = getSwiftCoreApi();
  for (;;) {
    outputSizeCell.writeULong(outputSize);
    const result = api.swift_demangle(namePtr, mangled.length, output, outputSizeCell, 0);
    if (result.isNull()) {
      return null;
    }
    const needed = Number(outputSizeCell.readULong());
    if (needed <= outputSize) {
      return output.readUtf8String();
    }
    outputSize = needed;
    output = Memory.alloc(outputSize);
  }
}

export function demangle(mangled: string): string | null {
  if (!isSwiftSymbol(mangled)) {
    return null;
  }

  const cached = cache.get(mangled);
  if (cached !== undefined) {
    return cached;
  }

  const result = demangleUncached(mangled);

  cache.set(mangled, result);
  return result;
}
