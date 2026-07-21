import { projectErrorExistential } from "../abi/existential.js";
import { readValue, SwiftValue } from "../abi/instance.js";
import { getSwiftCoreApi } from "./api.js";

export function decodeThrownError(errorBox: NativePointer): SwiftValue {
  const container = Memory.alloc(Process.pointerSize).writePointer(errorBox);
  const { type, value } = projectErrorExistential(container);
  return readValue(type, value);
}

// Never released here: a script-injected box (SwiftThrow) may not be a real error box.
const scriptOwnedBoxes = new Set<string>();

export function markScriptOwnedErrorBox(box: NativePointer): void {
  scriptOwnedBoxes.add(box.toString());
}

// Sync and async throws surface the same way: the raw error existential, decoded lazily so a raw
// box that is not a valid existential (as raw closure paths hand back) never forces a decode.
export class SwiftError extends Error {
  constructor(readonly error: NativePointer, owned = false) {
    super(`Swift function threw (error at ${error})`);
    this.name = "SwiftError";
    if (owned && !scriptOwnedBoxes.delete(error.toString())) {
      const release = getSwiftCoreApi().swift_errorRelease;
      Script.bindWeak(this, () => {
        release(error);
      });
    }
  }

  get value(): SwiftValue {
    return decodeThrownError(this.error);
  }
}
