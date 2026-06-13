import { getSwiftCoreApi } from "./api.js";

const SWIFT_SYMBOL_PREFIXES = ["$s", "_$s", "$S", "_$S", "_T0"];

export function isSwiftSymbol(name: string): boolean {
  return SWIFT_SYMBOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const cache = new Map<string, string | null>();

export function demangle(mangled: string): string | null {
  if (!isSwiftSymbol(mangled)) {
    return null;
  }

  const cached = cache.get(mangled);
  if (cached !== undefined) {
    return cached;
  }

  const namePtr = Memory.allocUtf8String(mangled);
  const resultPtr = getSwiftCoreApi().swift_demangle(
    namePtr,
    mangled.length,
    ptr(0),
    ptr(0),
    0
  );
  const result = resultPtr.isNull() ? null : resultPtr.readUtf8String();

  cache.set(mangled, result);
  return result;
}
