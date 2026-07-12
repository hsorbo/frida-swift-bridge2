import { test, expect, describe } from "@frida/injest/agent";
import { fixtureExport } from "./fixtures/load.js";

import { Swift, ClassInstance } from "../src/index.js";
import { makeSwiftNativeFunction } from "../src/runtime/calling-convention.js";

function intArg(n: number): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writeS64(n);
  return cell;
}

function ptrArg(p: NativePointer): NativePointer {
  const cell = Memory.alloc(Process.pointerSize);
  cell.writePointer(p);
  return cell;
}

function freshWrapper(): { token: ClassInstance; wrapperPtr: NativePointer } {
  const Int = Swift.metadataFor("Swift.Int")!;
  const Token = Swift.metadataFor("fixture.Token")!;
  const Wrapper = Swift.metadataFor("fixture.Wrapper")!;
  const makeToken = makeSwiftNativeFunction(fixtureExport("fixture.makeToken"), Token, [Int]);
  const makeWrapper = makeSwiftNativeFunction(fixtureExport("fixture.makeWrapper"), Wrapper, [
    Token,
  ]);
  const tokenRef = makeToken(intArg(5))!.readPointer();
  const wrapperPtr = makeWrapper(ptrArg(tokenRef))!;
  return { token: new ClassInstance(tokenRef), wrapperPtr };
}

describe("consumed (+1) indirect arguments", () => {
  test("consumedArgs passes a witness copy so the caller's value survives", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Wrapper = Swift.metadataFor("fixture.Wrapper")!;
    const { token, wrapperPtr } = freshWrapper();
    const before = token.retainCount;
    const consume = makeSwiftNativeFunction(
      fixtureExport("fixture.consumeWrapper"),
      Int,
      [Wrapper],
      { consumedArgs: [0] }
    );
    expect(consume(wrapperPtr)!.readS64().toNumber()).toBe(5);
    expect(token.retainCount).toBe(before);
  });

  test("without consumedArgs the callee consumes the caller's value", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Wrapper = Swift.metadataFor("fixture.Wrapper")!;
    const { token, wrapperPtr } = freshWrapper();
    const before = token.retainCount;
    const consume = makeSwiftNativeFunction(
      fixtureExport("fixture.consumeWrapper"),
      Int,
      [Wrapper]
    );
    expect(consume(wrapperPtr)!.readS64().toNumber()).toBe(5);
    expect(token.retainCount).toBe(before - 1);
  });
});
