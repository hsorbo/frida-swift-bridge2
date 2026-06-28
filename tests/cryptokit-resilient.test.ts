import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift, type Skip } from "./swift.js";

import {
  Swift,
  StructType,
  Value,
  isResilientValueType,
  makeSwiftNativeFunction,
  resolveMethod,
  getProperty,
} from "../src/index.js";

// Only Apple frameworks set the layout-string bit, so auto-detection's positive path needs CryptoKit;
// the indirect-ABI machinery is fixture-tested in resilient-calling.test.ts.

function loadCryptoKit(skip: Skip): void {
  requireSwift(skip);
  if (Process.findModuleByName("CryptoKit") === null) {
    try {
      Module.load("/System/Library/Frameworks/CryptoKit.framework/CryptoKit");
    } catch (e) {
      skip(`could not load CryptoKit: ${e}`);
    }
  }
}

// Resilient init(size:): SymmetricKeySize @in, SymmetricKey @out, auto-lowered from plain metadata.
// Result is the 1-word SecureBytes.Backing pointer.
function makeKey(bitCount: number): NativePointer {
  const sizeMd = Swift.metadataFor("CryptoKit.SymmetricKeySize")!;
  const keyMd = Swift.metadataFor("CryptoKit.SymmetricKey")!;
  const init = makeSwiftNativeFunction(
    resolveMethod("CryptoKit.SymmetricKey", "init", { labels: ["size"] }).address,
    keyMd,
    [sizeMd]
  );
  const sizeBuf = Memory.alloc(sizeMd.typeLayout.stride);
  sizeBuf.writeU64(bitCount);
  return init(sizeBuf)!;
}

describe("resilient auto-detection (CryptoKit)", () => {
  test("resilient value types are detected and called indirect from plain metadata", ({ skip }) => {
    loadCryptoKit(skip);

    expect(isResilientValueType(Swift.metadataFor("CryptoKit.SymmetricKeySize")!)).toBe(true);
    expect(isResilientValueType(Swift.metadataFor("Swift.Int")!)).toBe(false);

    expect(getProperty(makeKey(256), "CryptoKit.SymmetricKey", "bitCount")).toBe(256);
  });

  test("constructs a resilient value type through the type wrapper", ({ skip }) => {
    loadCryptoKit(skip);

    const sizeMd = Swift.metadataFor("CryptoKit.SymmetricKeySize")!;
    const sizeBuf = Memory.alloc(sizeMd.typeLayout.stride);
    sizeBuf.writeU64(256);

    const keyType = Swift.typeOf(Swift.metadataFor("CryptoKit.SymmetricKey")!) as StructType;
    const key = keyType.initializer({ labels: ["size"] }).call(Value.borrow(sizeMd, sizeBuf));

    expect(getProperty(key.address, "CryptoKit.SymmetricKey", "bitCount")).toBe(256);
  });
});
