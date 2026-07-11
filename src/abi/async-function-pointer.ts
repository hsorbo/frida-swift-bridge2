import { RelativeDirectPointer } from "../basic/relative-pointer.js";

const OFFSETOF_FUNCTION = 0x0;
const OFFSETOF_EXPECTED_CONTEXT_SIZE = 0x4;

// A `…Tu` symbol addresses this record, not code (ABI/Executor.h).
export class AsyncFunctionPointer {
  constructor(readonly handle: NativePointer) {}

  get code(): NativePointer {
    return RelativeDirectPointer.resolve(this.handle.add(OFFSETOF_FUNCTION))!;
  }

  get expectedContextSize(): number {
    return this.handle.add(OFFSETOF_EXPECTED_CONTEXT_SIZE).readU32();
  }
}

export function isAsyncFunctionPointerSymbol(mangled: string): boolean {
  return /^_?\$[sS]/.test(mangled) && mangled.endsWith("Tu");
}
