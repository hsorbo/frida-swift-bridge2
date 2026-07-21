import { getSwiftCoreApi } from "./api.js";

// Never released by the bridge: a script-injected box (SwiftThrow) may not be a real error box, and
// its ownership stays with the script.
const scriptOwnedBoxes = new Set<string>();

export function markScriptOwnedErrorBox(box: NativePointer): void {
  scriptOwnedBoxes.add(box.toString());
}

// Release the +1 error box when `owner` is collected, unless the box was script-injected.
export function releaseErrorBoxWhenCollected(owner: object, box: NativePointer): void {
  if (scriptOwnedBoxes.delete(box.toString())) {
    return;
  }
  const release = getSwiftCoreApi().swift_errorRelease;
  Script.bindWeak(owner, () => {
    release(box);
  });
}
