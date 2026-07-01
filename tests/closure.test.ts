import { test, expect, describe } from "@frida/injest/agent";
import { requireClosures } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, ValueInstance } from "../src/index.js";
import { makeSwiftNativeFunction, indirect, SwiftThrownError } from "../src/runtime/calling-convention.js";
import { getSwiftCoreApi } from "../src/runtime/api.js";
import { SwiftClosure, SwiftThrow } from "../src/runtime/closure.js";
import {
  closureDiscriminator,
  closureHashString,
  INDIRECT,
} from "../src/runtime/closure-discriminator.js";

function fixtureFn(swiftName: string): NativePointer {
  const mod = loadFixture();
  for (const e of mod.enumerateExports()) {
    const demangled = Swift.demangle(e.name);
    if (demangled !== null && demangled.includes(swiftName)) {
      return e.address;
    }
  }
  throw new Error(`fixture export not found: ${swiftName}`);
}

describe("closure as a Swift argument", (ctx) => {
  requireClosures(ctx);
  test("marshals a closure as a 2-word arg and routes a buffer into its body", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0x11, 0x22, 0x33, 0x44, 0x55];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const discriminator = closureDiscriminator(closureHashString(["$sSW"], []));
    expect(discriminator).toBe(0xf220);

    let seen: number[] | null = null;
    const closure = SwiftClosure.overBytes((buf) => {
      seen = Array.from(new Uint8Array(buf.readBytes()));
    }, discriminator);

    const invoke = makeSwiftNativeFunction(fixtureFn("invokeWithBytes"), null, [
      Int,
      Int,
      { closure: true },
    ]);

    const baseArg = Memory.alloc(8);
    baseArg.writePointer(buffer);
    const countArg = Memory.alloc(8);
    countArg.writeU64(data.length);

    invoke(baseArg, countArg, closure.value());

    expect(seen).not.toBe(null);
    expect(seen!.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      expect(seen![i]).toBe(data[i]);
    }
  });

  test("drives a real generic rethrows function with the abstracted discriminator", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0xde, 0xad, 0xbe, 0xef];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const discriminator = closureDiscriminator(closureHashString(["$sSW"], [INDIRECT]));
    expect(discriminator).toBe(0x323);

    let seen: number[] | null = null;
    const closure = SwiftClosure.overBytes((buf) => {
      seen = Array.from(new Uint8Array(buf.readBytes()));
    }, discriminator);

    const invoke = makeSwiftNativeFunction(
      fixtureFn("invokeGeneric"),
      null,
      [Int, Int, { closure: true }],
      { typeArguments: [Int], throws: true }
    );

    const baseArg = Memory.alloc(8);
    baseArg.writePointer(buffer);
    const countArg = Memory.alloc(8);
    countArg.writeU64(data.length);
    invoke(baseArg, countArg, closure.value());

    expect(seen).not.toBe(null);
    expect(seen!.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      expect(seen![i]).toBe(data[i]);
    }
  });
});

describe("closure result and error routing", (ctx) => {
  requireClosures(ctx);
  test("writes its result through x8 and Swift returns it", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0xaa, 0xbb];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const discriminator = closureDiscriminator(closureHashString(["$sSW"], [INDIRECT]));
    const closure = SwiftClosure.overBytes((buf, result) => {
      result.writeU64(0x1234 + buf.count);
    }, discriminator);

    const invoke = makeSwiftNativeFunction(
      fixtureFn("invokeReturning"),
      indirect(Int),
      [Int, Int, { closure: true }],
      { typeArguments: [Int], throws: true }
    );

    const baseArg = Memory.alloc(8);
    baseArg.writePointer(buffer);
    const countArg = Memory.alloc(8);
    countArg.writeU64(data.length);

    const ret = invoke(baseArg, countArg, closure.value());
    expect(ret).not.toBe(null);
    expect(ret!.readU64().toNumber()).toBe(0x1234 + data.length);
  });

  test("sets x21 so a rethrows function propagates the closure's error", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0x01, 0x02];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const errorObj = Memory.alloc(Process.pointerSize);

    const discriminator = closureDiscriminator(closureHashString(["$sSW"], [INDIRECT]));
    const closure = SwiftClosure.overBytes(() => errorObj, discriminator, { throws: true });

    const invoke = makeSwiftNativeFunction(
      fixtureFn("invokeGeneric"),
      null,
      [Int, Int, { closure: true }],
      { typeArguments: [Int], throws: true }
    );

    const baseArg = Memory.alloc(8);
    baseArg.writePointer(buffer);
    const countArg = Memory.alloc(8);
    countArg.writeU64(data.length);

    let thrown: SwiftThrownError | null = null;
    try {
      invoke(baseArg, countArg, closure.value());
    } catch (e) {
      thrown = e as SwiftThrownError;
    }
    expect(thrown).not.toBe(null);
    expect(thrown!.error.equals(errorObj)).toBe(true);
  });
});

describe("escaping closure context", (ctx) => {
  requireClosures(ctx);
  // The synthesized context is a real heap object: only its destroy slot (M-16) is read on release,
  // and Swift runs destroy when the strong count reaches zero.
  test("a synthesized refcounted context runs destroy when released to zero", () => {
    const api = getSwiftCoreApi();

    const block = Memory.alloc(Process.pointerSize * 4);
    const metadata = block.add(Process.pointerSize * 3);
    let context = ptr(0);
    let destroyed = false;
    const destroy = new NativeCallback(
      () => {
        destroyed = true;
        api.swift_deallocObject(context, 16, 7);
      },
      "void",
      []
    );
    metadata.sub(16).writePointer(destroy);
    context = api.swift_allocObject(metadata, 16, 7) as NativePointer;

    expect(Number(api.swift_retainCount(context))).toBe(1);
    api.swift_retain(context);
    api.swift_release(context);
    expect(destroyed).toBe(false);
    api.swift_release(context);
    expect(destroyed).toBe(true);
  });

  test("an escaping () -> Void closure is retained, invoked after return, then released", () => {
    const api = getSwiftCoreApi();

    let fired = 0;
    const closure = SwiftClosure.overBytes(
      () => {
        fired++;
      },
      closureDiscriminator(closureHashString([], []))
    );
    const retainCount = (): number => Number(api.swift_retainCount(closure.context));

    const storeEscaping = makeSwiftNativeFunction(
      fixtureFn("storeEscaping"),
      null,
      [{ closure: true }]
    );
    const fireEscaping = makeSwiftNativeFunction(fixtureFn("fireEscaping"), null, []);
    const releaseEscaping = makeSwiftNativeFunction(
      fixtureFn("releaseEscaping"),
      null,
      []
    );

    expect(retainCount()).toBe(1);
    storeEscaping(closure.value());
    expect(retainCount()).toBe(2); // +0 guaranteed: Swift retained its own copy

    fireEscaping();
    fireEscaping();
    expect(fired).toBe(2); // invoked after storeEscaping returned -> escaped, resources still live

    releaseEscaping();
    expect(retainCount()).toBe(1); // Swift dropped its ref; our +1 still holds the context
  });
});

describe("closure through the $call facade", (ctx) => {
  requireClosures(ctx);
  test("Swift.closure passed to a generic rethrows method receives the bytes", () => {
    loadFixture();

    const data = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(buffer);
    self.add(Process.pointerSize).writeU64(data.length);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    let seen: number[] | null = null;
    source.$call(
      "withBytes",
      Swift.closure((buf) => {
        seen = Array.from(new Uint8Array(buf.readBytes()));
      })
    );

    expect(seen).not.toBe(null);
    expect(seen!.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      expect(seen![i]).toBe(data[i]);
    }
  });

  test("Swift.closure passed to a non-generic (buffer) -> Void method receives the bytes", () => {
    loadFixture();

    const data = [0x09, 0x08, 0x07];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(buffer);
    self.add(Process.pointerSize).writeU64(data.length);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    let seen: number[] | null = null;
    source.$call(
      "eachByte",
      Swift.closure((buf) => {
        seen = Array.from(new Uint8Array(buf.readBytes()));
      })
    );

    expect(seen).toEqual(data);
  });

  test("Swift.closure passed to a non-generic () -> Void method is invoked", () => {
    loadFixture();

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    let called = false;
    source.$call(
      "run",
      Swift.closure(() => {
        called = true;
      })
    );

    expect(called).toBe(true);
  });
});

describe("loadable closures (register-passed params and result)", (ctx) => {
  requireClosures(ctx);
  test("marshals a (Int) -> Int closure: value in x0, result in x0", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSi"], ["$sSi"]));
    expect(discriminator).toBe(0x489b);

    const closure = SwiftClosure.loadable((n) => Number(n) * 3, ["int64"], "int64", discriminator);
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeMapping"), Int, [Int, { closure: true }]);

    const nArg = Memory.alloc(8);
    nArg.writeU64(7);
    const ret = invoke(nArg, closure.value());
    expect(ret!.readU64().toNumber()).toBe(21);
  });

  test("marshals a (Int, Int) -> Int closure across two arg registers", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSi", "$sSi"], ["$sSi"]));
    expect(discriminator).toBe(0x97c8);

    const closure = SwiftClosure.loadable(
      (a, b) => Number(a) + Number(b),
      ["int64", "int64"],
      "int64",
      discriminator
    );
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeCombine"), Int, [Int, Int, { closure: true }]);

    const aArg = Memory.alloc(8);
    aArg.writeU64(20);
    const bArg = Memory.alloc(8);
    bArg.writeU64(22);
    const ret = invoke(aArg, bArg, closure.value());
    expect(ret!.readU64().toNumber()).toBe(42);
  });

  test("marshals a (Double) -> Double closure through the v-registers", () => {
    const Double = Swift.metadataFor("Swift.Double")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSd"], ["$sSd"]));
    expect(discriminator).toBe(0xe4d1);
    const closure = SwiftClosure.loadable((x) => Number(x) / 2, ["double"], "double", discriminator);
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeScale"), Double, [Double, { closure: true }]);

    const xArg = Memory.alloc(8);
    xArg.writeDouble(7);
    expect(invoke(xArg, closure.value())!.readDouble()).toBe(3.5);
  });

  test("marshals a (Int) -> Bool closure: Swift reads the bool result", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSi"], ["$sSb"]));
    expect(discriminator).toBe(0xd26c);

    const closure = SwiftClosure.loadable((n) => Number(n) > 5, ["int64"], "bool", discriminator);
    const invoke = makeSwiftNativeFunction(fixtureFn("invokePredicate"), Bool, [Int, { closure: true }]);

    const yes = Memory.alloc(8);
    yes.writeU64(9);
    expect(invoke(yes, closure.value())!.readU8()).toBe(1);

    const no = Memory.alloc(8);
    no.writeU64(2);
    expect(invoke(no, closure.value())!.readU8()).toBe(0);
  });
});

describe("loadable closure through the $call facade", (ctx) => {
  requireClosures(ctx);
  function byteSource(): ReturnType<typeof Swift.Object> {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    return Swift.Object(ValueInstance.borrow(ByteSource, self));
  }

  test("Swift.closure (Int) -> Int returns the mapped value", () => {
    loadFixture();
    const result = byteSource().$call("apply", 7, Swift.closure((n: number) => Number(n) * 6));
    expect(result).toBe(42);
  });

  test("Swift.closure (Int) -> Bool returns the predicate result", () => {
    loadFixture();
    const source = byteSource();
    expect(source.$call("check", 9, Swift.closure((n: number) => Number(n) > 5))).toBe(true);
    expect(source.$call("check", 2, Swift.closure((n: number) => Number(n) > 5))).toBe(false);
  });
});

describe("throwing loadable closures", (ctx) => {
  requireClosures(ctx);
  test("a non-throwing body returns its result through a throws closure type", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;

    // throws is ignored in the discriminator, so it matches the non-throwing (Int) -> Bool.
    const discriminator = closureDiscriminator(closureHashString(["$sSi"], ["$sSb"]));
    expect(discriminator).toBe(0xd26c);

    const closure = SwiftClosure.loadable((n) => Number(n) > 5, ["int64"], "bool", discriminator, {
      throws: true,
    });
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeThrowing"), Bool, [Int, { closure: true }], {
      throws: true,
    });

    const yes = Memory.alloc(8);
    yes.writeU64(9);
    expect(invoke(yes, closure.value())!.readU8()).toBe(1);
    const no = Memory.alloc(8);
    no.writeU64(2);
    expect(invoke(no, closure.value())!.readU8()).toBe(0);
  });

  test("a SwiftThrow body sets x21 so the rethrows function propagates the error", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;
    const errorObj = Memory.alloc(Process.pointerSize);

    const discriminator = closureDiscriminator(closureHashString(["$sSi"], ["$sSb"]));
    const closure = SwiftClosure.loadable(() => new SwiftThrow(errorObj), ["int64"], "bool", discriminator, {
      throws: true,
    });
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeThrowing"), Bool, [Int, { closure: true }], {
      throws: true,
    });

    const nArg = Memory.alloc(8);
    nArg.writeU64(3);

    let thrown: SwiftThrownError | null = null;
    try {
      invoke(nArg, closure.value());
    } catch (e) {
      thrown = e as SwiftThrownError;
    }
    expect(thrown).not.toBe(null);
    expect(thrown!.error.equals(errorObj)).toBe(true);
  });

  test("Swift.closure passed to a throwing-closure method returns the predicate result", () => {
    loadFixture();

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    expect(source.$call("tryCheck", 9, Swift.closure((n: number) => Number(n) > 5))).toBe(true);
    expect(source.$call("tryCheck", 2, Swift.closure((n: number) => Number(n) > 5))).toBe(false);
  });
});

describe("sized-int and pointer loadable closures", (ctx) => {
  requireClosures(ctx);
  test("marshals a (Int32) -> Int32 closure", () => {
    const Int32 = Swift.metadataFor("Swift.Int32")!;

    const discriminator = closureDiscriminator(closureHashString(["$ss5Int32V"], ["$ss5Int32V"]));
    expect(discriminator).toBe(0x3fe6);

    const closure = SwiftClosure.loadable((n) => Number(n) + 100, ["int32"], "int32", discriminator);
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeI32"), Int32, [Int32, { closure: true }]);

    const nArg = Memory.alloc(4);
    nArg.writeS32(5);
    expect(invoke(nArg, closure.value())!.readS32()).toBe(105);
  });

  test("marshals a (UnsafeRawPointer) -> UnsafeRawPointer closure", () => {
    const Raw = Swift.metadataFor("Swift.UnsafeRawPointer")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSV"], ["$sSV"]));
    expect(discriminator).toBe(0x6528);

    const closure = SwiftClosure.loadable((p) => (p as NativePointer).add(8), ["pointer"], "pointer", discriminator);
    const invoke = makeSwiftNativeFunction(fixtureFn("invokeRawPtr"), Raw, [Raw, { closure: true }]);

    const base = Memory.alloc(16);
    const pArg = Memory.alloc(Process.pointerSize);
    pArg.writePointer(base);
    expect(invoke(pArg, closure.value())!.readPointer().equals(base.add(8))).toBe(true);
  });

  test("Swift.closure (Int32) -> Int32 through the facade", () => {
    loadFixture();

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    expect(source.$call("mapI32", 5, Swift.closure((n: number) => Number(n) + 100))).toBe(105);
  });
});

describe("loadable param with an indirect result", (ctx) => {
  requireClosures(ctx);
  test("marshals a (Int) -> R closure writing its result through x8", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const discriminator = closureDiscriminator(closureHashString(["$sSi"], [INDIRECT]));
    expect(discriminator).toBe(0xe7b2);

    const closure = SwiftClosure.loadableProducing(
      (args, result) => {
        result.writeU64(Number(args[0]) * 4);
      },
      ["int64"],
      discriminator
    );
    const invoke = makeSwiftNativeFunction(
      fixtureFn("invokeProducing"),
      indirect(Int),
      [Int, { closure: true }],
      { typeArguments: [Int] }
    );

    const nArg = Memory.alloc(8);
    nArg.writeU64(8);
    expect(invoke(nArg, closure.value())!.readU64().toNumber()).toBe(32);
  });

  test("Swift.closure (Int) -> R through $method with an explicit type argument", () => {
    loadFixture();
    const Int = Swift.metadataFor("Swift.Int")!;

    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    const result = source
      .$method("produce", { typeArguments: [Int] })
      .call(6, Swift.closure((n: number) => Number(n) * 7));
    expect(result).toBe(42);
  });
});

describe("String loadable closures through the facade", (ctx) => {
  requireClosures(ctx);
  function byteSource(): ReturnType<typeof Swift.Object> {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    return Swift.Object(ValueInstance.borrow(ByteSource, self));
  }

  test("(String) -> String round-trips a small inline string", () => {
    loadFixture();
    const result = byteSource().$call("mapStr", "frida", Swift.closure((s: string) => s.toUpperCase()));
    expect(result).toBe("FRIDA");
  });

  test("(String) -> String preserves all 16 bytes of a 12-char inline string", () => {
    loadFixture();
    // 9–15 char strings store content in the high word; pointer-typed words avoid double precision loss.
    const result = byteSource().$call("mapStr", "abcdefghijkl", Swift.closure((s: string) => s.split("").reverse().join("")));
    expect(result).toBe("lkjihgfedcba");
  });

  test("(String) -> String round-trips a heap-allocated string", () => {
    loadFixture();
    const long = "the quick brown fox jumps over the lazy dog";
    const result = byteSource().$call("mapStr", long, Swift.closure((s: string) => s.toUpperCase()));
    expect(result).toBe(long.toUpperCase());
  });

  test("(String) -> Int passes the string and returns a scalar", () => {
    loadFixture();
    expect(byteSource().$call("strLen", "héllo", Swift.closure((s: string) => s.length))).toBe(5);
  });

  test("(Int) -> String returns a synthesized string", () => {
    loadFixture();
    expect(byteSource().$call("label", 7, Swift.closure((n: number) => `n=${n}`))).toBe("n=7");
  });
});

describe("closure discriminator", () => {
  test("reproduces Swift's per-signature discriminators", () => {
    expect(closureDiscriminator(closureHashString([], []))).toBe(0xf08);
    expect(closureDiscriminator(closureHashString(["$sSi"], ["$sSi"]))).toBe(0x489b);
    expect(closureDiscriminator(closureHashString(["$sSi", "$sSi"], ["$sSi"]))).toBe(0x97c8);
    expect(closureDiscriminator(closureHashString(["$sSi"], ["$sSb"]))).toBe(0xd26c);
    expect(closureDiscriminator(closureHashString(["$sSd"], ["$sSd"]))).toBe(0xe4d1);
    expect(closureDiscriminator(closureHashString(["$sSW"], []))).toBe(0xf220);
    expect(closureDiscriminator(closureHashString(["$sSW"], [INDIRECT]))).toBe(0x0323);
    expect(closureDiscriminator(closureHashString(["$sSi"], [INDIRECT]))).toBe(0xe7b2);
    expect(closureDiscriminator(closureHashString(["$ss5Int32V"], ["$ss5Int32V"]))).toBe(0x3fe6);
    expect(closureDiscriminator(closureHashString(["$sSV"], ["$sSV"]))).toBe(0x6528);
  });
});
