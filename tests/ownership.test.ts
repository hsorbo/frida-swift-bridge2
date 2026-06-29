import { test, expect, describe } from "@frida/injest/agent";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ClassType, ClassInstance, SwiftObject } from "../src/index.js";

function robotType(): ClassType {
  return Swift.typeOf(Swift.metadataFor("fixture.Robot")!) as ClassType;
}

// Large (heap) String: __StringStorage pointer at +8, low 60 bits.
const LARGE_ADDRESS_MASK = ptr("0x0fffffffffffffff");
function stringStorage(inlineString: NativePointer): ClassInstance {
  return new ClassInstance(inlineString.add(8).readPointer().and(LARGE_ADDRESS_MASK));
}

describe("ownership", () => {
  test("$dispose drops the strong count once; double dispose is a no-op", () => {
    loadFixture();
    const owned = robotType().init("R2");
    expect(owned.$owned).toBe(true);
    owned.$retain(); // outlive the dispose so view can observe the drop
    const view = new ClassInstance(owned.handle);
    const before = view.retainCount;
    owned.$dispose();
    expect(view.retainCount).toBe(before - 1);
    owned.$dispose();
    expect(view.retainCount).toBe(before - 1);
    view.release();
  });

  test("a class return is owned; disposing a borrowed wrapper does not release", () => {
    loadFixture();
    const made = robotType().call("make", "Forged") as SwiftObject;
    expect(made.$owned).toBe(true);
    made.$retain();
    const view = new ClassInstance(made.handle);
    expect(view.owned).toBe(false);
    const before = view.retainCount;
    view.dispose(); // borrowed → no-op
    expect(view.retainCount).toBe(before);
    made.$dispose(); // owned → release once
    expect(view.retainCount).toBe(before - 1);
    view.release();
  });

  // No GC-release test: bindWeak finalizers fire on a later pass, not synchronously with gc().

  test("a String getter return destroys its +1 temp, leaking no __StringStorage ref", () => {
    loadFixture();
    const r = robotType().init("a deliberately long, heap-allocated robot name");
    const storage = stringStorage(r.$field("name").address);
    const before = storage.retainCount;
    for (let i = 0; i < 20; i++) {
      expect(typeof r.$get("name")).toBe("string");
    }
    expect(storage.retainCount).toBe(before);
  });

  // rename retains the +0/guaranteed arg into the field; a leaked temp would leave rc 2, not 1.
  test("a regular method's String arg +1 temp is destroyed, not leaked alongside the stored field", () => {
    loadFixture();
    const r = robotType().init("short");
    r.$call("rename", "a deliberately long, heap-allocated robot name");
    const storage = stringStorage(r.$field("name").address);
    expect(storage.retainCount).toBe(1);
  });
});
