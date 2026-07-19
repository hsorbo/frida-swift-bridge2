import { test, expect, describe } from "@frida/injest/agent";

import {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "../src/basic/relative-pointer.js";

describe("relative pointers", () => {
  test("direct resolves a forward offset", () => {
    const at = Memory.alloc(4);
    at.writeS32(0x40);
    expect(RelativeDirectPointer.resolve(at)!.equals(at.add(0x40))).toBeTruthy();
  });

  test("direct resolves a negative offset", () => {
    const at = Memory.alloc(4);
    at.writeS32(-0x10);
    expect(RelativeDirectPointer.resolve(at)!.equals(at.add(-0x10))).toBeTruthy();
  });

  test("direct returns null for a zero offset", () => {
    const at = Memory.alloc(4);
    at.writeS32(0);
    expect(RelativeDirectPointer.resolve(at)).toBeNull();
  });

  test("indirectable resolves a direct (even) offset", () => {
    const at = Memory.alloc(4);
    at.writeS32(0x20);
    expect(
      RelativeIndirectablePointer.resolve(at)!.equals(at.add(0x20))
    ).toBeTruthy();
  });

  test("indirectable dereferences an indirect (odd) offset", () => {
    const block = Memory.alloc(Process.pointerSize * 2);
    const slot = block;
    const target = ptr(0xdeadbeef);
    slot.writePointer(target);

    const at = block.add(Process.pointerSize);
    const offset = slot.sub(at).toInt32() | 1;
    at.writeS32(offset);

    expect(RelativeIndirectablePointer.resolve(at)!.equals(target)).toBeTruthy();
  });

  test("indirectable returns null for an unbound (null) indirect slot", () => {
    const block = Memory.alloc(Process.pointerSize * 2);
    const slot = block;
    slot.writePointer(NULL);

    const at = block.add(Process.pointerSize);
    const offset = slot.sub(at).toInt32() | 1;
    at.writeS32(offset);

    expect(RelativeIndirectablePointer.resolve(at)).toBeNull();
  });
});
