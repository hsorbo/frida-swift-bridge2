import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";

import {
  Swift,
  StructType,
  ValueInstance,
  isResilientValueType,
  makeSwiftNativeFunction,
  resolveMethod,
} from "../src/index.js";

// markResilient drives auto-detection for a real Apple resilient framework on any OS; the
// indirect-ABI machinery itself is fixture-tested in resilient-calling.test.ts.

function loadCryptoKit(): void {
  requireSwift();
  if (Process.findModuleByName("CryptoKit") === null) {
    try {
      Module.load("/System/Library/Frameworks/CryptoKit.framework/CryptoKit");
    } catch (e) {
      throw new Error(`could not load CryptoKit: ${e}`);
    }
  }
  Swift.markResilient("CryptoKit");
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
  test("resilient value types are detected and called indirect from plain metadata", () => {
    loadCryptoKit();

    expect(isResilientValueType(Swift.metadataFor("CryptoKit.SymmetricKeySize")!)).toBe(true);
    expect(isResilientValueType(Swift.metadataFor("Swift.Int")!)).toBe(false);

    const keyMd = Swift.metadataFor("CryptoKit.SymmetricKey")!;
    expect(ValueInstance.borrow(keyMd, makeKey(256)).get("bitCount")).toBe(256);
  });

  test("constructs a resilient value type through the type wrapper", () => {
    loadCryptoKit();

    const sizeMd = Swift.metadataFor("CryptoKit.SymmetricKeySize")!;
    const sizeBuf = Memory.alloc(sizeMd.typeLayout.stride);
    sizeBuf.writeU64(256);

    const keyType = Swift.typeOf(Swift.metadataFor("CryptoKit.SymmetricKey")!) as StructType;
    const key = keyType.initializer({ labels: ["size"] }).call(ValueInstance.borrow(sizeMd, sizeBuf));

    expect(key.$get("bitCount")).toBe(256);
  });
});
