import { ContextDescriptor } from "./context-descriptor.js";
import { MangledName, symbolicMangledNameLength } from "./field-descriptor.js";
import { RelativeDirectPointer } from "../basic/relative-pointer.js";
import { demangle } from "../runtime/demangle.js";

const OFFSETOF_EXTENDED_CONTEXT = 0x8;

export function extendedContextName(descriptor: ContextDescriptor): MangledName | null {
  const ptr = RelativeDirectPointer.resolve(descriptor.handle.add(OFFSETOF_EXTENDED_CONTEXT));
  return ptr === null ? null : { address: ptr, length: symbolicMangledNameLength(ptr) };
}

// The nominal name of the type an extension extends, without realizing metadata. A symbolic
// reference follows its descriptor; an ordinary mangling (e.g. `extension Optional` -> "xSg") is
// demangled as a type ($s prefix), keeping the nominal base and dropping generic parameters.
export function extendedTypeName(extension: ContextDescriptor): string | null {
  const byDescriptor = extension.extendedTypeDescriptor;
  if (byDescriptor !== null) {
    return byDescriptor.fullTypeName;
  }
  const mangled = extendedContextName(extension);
  if (mangled === null) {
    return null;
  }
  // Only a pure printable-ASCII mangling is demangleable as a standalone string; a symbolic
  // reference (control bytes) would have been resolved above, so anything else is unsupported.
  const bytes = new Uint8Array(mangled.address.readByteArray(mangled.length)!);
  let text = "";
  for (const b of bytes) {
    if (b < 0x20 || b >= 0x7f) {
      return null;
    }
    text += String.fromCharCode(b);
  }
  const demangled = demangle("$s" + text);
  if (demangled === null) {
    return null;
  }
  const generic = demangled.indexOf("<");
  return generic === -1 ? demangled : demangled.slice(0, generic);
}
