import { test, expect, describe, beforeEach } from "@frida/injest/agent";
import { requireClosures } from "./swift.js";
import { loadFixture, fixtureExport } from "./fixtures/load.js";

import { Swift, ValueInstance } from "../src/index.js";
import { makeSwiftNativeFunction, indirect, SwiftThrownError } from "../src/runtime/calling-convention.js";
import { getSwiftCoreApi } from "../src/runtime/api.js";
import { SwiftClosure, SwiftThrow } from "../src/runtime/closure.js";

describe("closure as a Swift argument", (ctx) => {
  requireClosures(ctx);
  test("marshals a closure as a 2-word arg and routes a buffer into its body", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0x11, 0x22, 0x33, 0x44, 0x55];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    let seen: number[] | null = null;
    const closure = SwiftClosure.overBytes((buf) => {
      seen = Array.from(new Uint8Array(buf.readBytes()));
    });

    const invoke = makeSwiftNativeFunction(fixtureExport("invokeWithBytes"), null, [
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

  test("drives a real generic rethrows function routing a buffer into its body", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const data = [0xde, 0xad, 0xbe, 0xef];
    const buffer = Memory.alloc(data.length);
    buffer.writeByteArray(data);

    let seen: number[] | null = null;
    const closure = SwiftClosure.overBytes((buf) => {
      seen = Array.from(new Uint8Array(buf.readBytes()));
    });

    const invoke = makeSwiftNativeFunction(
      fixtureExport("invokeGeneric"),
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

    const closure = SwiftClosure.overBytes((buf, result) => {
      result.writeU64(0x1234 + buf.count);
    });

    const invoke = makeSwiftNativeFunction(
      fixtureExport("invokeReturning"),
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

    const closure = SwiftClosure.overBytes(() => errorObj, { throws: true });

    const invoke = makeSwiftNativeFunction(
      fixtureExport("invokeGeneric"),
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
    metadata.writeU64(0x400);
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
    const closure = SwiftClosure.overBytes(() => {
      fired++;
    });
    const retainCount = (): number => Number(api.swift_retainCount(closure.context));

    const storeEscaping = makeSwiftNativeFunction(
      fixtureExport("storeEscaping"),
      null,
      [{ closure: true }]
    );
    const fireEscaping = makeSwiftNativeFunction(fixtureExport("fireEscaping"), null, []);
    const releaseEscaping = makeSwiftNativeFunction(
      fixtureExport("releaseEscaping"),
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
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  test("Swift.closure passed to a generic rethrows method receives the bytes", () => {
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

  test("Swift.closure that throws propagates through a rethrowing buffer method", () => {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    const errorObj = Memory.alloc(Process.pointerSize);
    let thrown: SwiftThrownError | null = null;
    try {
      source.$call("withBytes", Swift.closure(() => new SwiftThrow(errorObj)));
    } catch (e) {
      thrown = e as SwiftThrownError;
    }
    expect(thrown).not.toBe(null);
    expect(thrown!.error.equals(errorObj)).toBe(true);
  });

  test("Swift.closure passed to a non-generic (buffer) -> Void method receives the bytes", () => {
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

    const closure = SwiftClosure.loadable((n) => Number(n) * 3, ["int64"], "int64");
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeMapping"), Int, [Int, { closure: true }]);

    const nArg = Memory.alloc(8);
    nArg.writeU64(7);
    const ret = invoke(nArg, closure.value());
    expect(ret!.readU64().toNumber()).toBe(21);
  });

  test("marshals a (Int, Int) -> Int closure across two arg registers", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const closure = SwiftClosure.loadable(
      (a, b) => Number(a) + Number(b),
      ["int64", "int64"],
      "int64"
    );
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeCombine"), Int, [Int, Int, { closure: true }]);

    const aArg = Memory.alloc(8);
    aArg.writeU64(20);
    const bArg = Memory.alloc(8);
    bArg.writeU64(22);
    const ret = invoke(aArg, bArg, closure.value());
    expect(ret!.readU64().toNumber()).toBe(42);
  });

  test("marshals a (Double) -> Double closure through the v-registers", () => {
    const Double = Swift.metadataFor("Swift.Double")!;

    const closure = SwiftClosure.loadable((x) => Number(x) / 2, ["double"], "double");
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeScale"), Double, [Double, { closure: true }]);

    const xArg = Memory.alloc(8);
    xArg.writeDouble(7);
    expect(invoke(xArg, closure.value())!.readDouble()).toBe(3.5);
  });

  test("marshals a (Int) -> Bool closure: Swift reads the bool result", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;

    const closure = SwiftClosure.loadable((n) => Number(n) > 5, ["int64"], "bool");
    const invoke = makeSwiftNativeFunction(fixtureExport("invokePredicate"), Bool, [Int, { closure: true }]);

    const yes = Memory.alloc(8);
    yes.writeU64(9);
    expect(invoke(yes, closure.value())!.readU8()).toBe(1);

    const no = Memory.alloc(8);
    no.writeU64(2);
    expect(invoke(no, closure.value())!.readU8()).toBe(0);
  });
});

describe("loadable closure through the $call facade", (ctx) => {
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  function byteSource(): ReturnType<typeof Swift.Object> {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    return Swift.Object(ValueInstance.borrow(ByteSource, self));
  }

  test("Swift.closure (Int) -> Int returns the mapped value", () => {
    const result = byteSource().$call("apply", 7, Swift.closure((n: number) => Number(n) * 6));
    expect(result).toBe(42);
  });

  test("Swift.closure (Int) -> Bool returns the predicate result", () => {
    const source = byteSource();
    expect(source.$call("check", 9, Swift.closure((n: number) => Number(n) > 5))).toBe(true);
    expect(source.$call("check", 2, Swift.closure((n: number) => Number(n) > 5))).toBe(false);
  });
});

describe("throwing loadable closures", (ctx) => {
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  test("a non-throwing body returns its result through a throws closure type", () => {
    const Int = Swift.metadataFor("Swift.Int")!;
    const Bool = Swift.metadataFor("Swift.Bool")!;

    const closure = SwiftClosure.loadable((n) => Number(n) > 5, ["int64"], "bool", {
      throws: true,
    });
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeThrowing"), Bool, [Int, { closure: true }], {
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

    const closure = SwiftClosure.loadable(() => new SwiftThrow(errorObj), ["int64"], "bool", {
      throws: true,
    });
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeThrowing"), Bool, [Int, { closure: true }], {
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
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  test("marshals a (Int32) -> Int32 closure", () => {
    const Int32 = Swift.metadataFor("Swift.Int32")!;

    const closure = SwiftClosure.loadable((n) => Number(n) + 100, ["int32"], "int32");
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeI32"), Int32, [Int32, { closure: true }]);

    const nArg = Memory.alloc(4);
    nArg.writeS32(5);
    expect(invoke(nArg, closure.value())!.readS32()).toBe(105);
  });

  test("marshals a (UnsafeRawPointer) -> UnsafeRawPointer closure", () => {
    const Raw = Swift.metadataFor("Swift.UnsafeRawPointer")!;

    const closure = SwiftClosure.loadable((p) => (p as NativePointer).add(8), ["pointer"], "pointer");
    const invoke = makeSwiftNativeFunction(fixtureExport("invokeRawPtr"), Raw, [Raw, { closure: true }]);

    const base = Memory.alloc(16);
    const pArg = Memory.alloc(Process.pointerSize);
    pArg.writePointer(base);
    expect(invoke(pArg, closure.value())!.readPointer().equals(base.add(8))).toBe(true);
  });

  test("Swift.closure (Int32) -> Int32 through the facade", () => {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    const source = Swift.Object(ValueInstance.borrow(ByteSource, self));

    expect(source.$call("mapI32", 5, Swift.closure((n: number) => Number(n) + 100))).toBe(105);
  });
});

describe("loadable param with an indirect result", (ctx) => {
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  test("marshals a (Int) -> R closure writing its result through x8", () => {
    const Int = Swift.metadataFor("Swift.Int")!;

    const closure = SwiftClosure.loadableProducing(
      (args, result) => {
        result.writeU64(Number(args[0]) * 4);
      },
      ["int64"]
    );
    const invoke = makeSwiftNativeFunction(
      fixtureExport("invokeProducing"),
      indirect(Int),
      [Int, { closure: true }],
      { typeArguments: [Int] }
    );

    const nArg = Memory.alloc(8);
    nArg.writeU64(8);
    expect(invoke(nArg, closure.value())!.readU64().toNumber()).toBe(32);
  });

  test("Swift.closure (Int) -> R through $method with an explicit type argument", () => {
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
  beforeEach(() => { loadFixture(); });

  requireClosures(ctx);
  function byteSource(): ReturnType<typeof Swift.Object> {
    const ByteSource = Swift.metadataFor("fixture.ByteSource")!;
    const self = Memory.alloc(ByteSource.valueWitnesses.stride);
    self.writePointer(Memory.alloc(1));
    self.add(Process.pointerSize).writeU64(0);
    return Swift.Object(ValueInstance.borrow(ByteSource, self));
  }

  test("(String) -> String round-trips a small inline string", () => {
    const result = byteSource().$call("mapStr", "frida", Swift.closure((s: string) => s.toUpperCase()));
    expect(result).toBe("FRIDA");
  });

  test("(String) -> String preserves all 16 bytes of a 12-char inline string", () => {
    // 9–15 char strings store content in the high word; pointer-typed words avoid double precision loss.
    const result = byteSource().$call("mapStr", "abcdefghijkl", Swift.closure((s: string) => s.split("").reverse().join("")));
    expect(result).toBe("lkjihgfedcba");
  });

  test("(String) -> String round-trips a heap-allocated string", () => {
    const long = "the quick brown fox jumps over the lazy dog";
    const result = byteSource().$call("mapStr", long, Swift.closure((s: string) => s.toUpperCase()));
    expect(result).toBe(long.toUpperCase());
  });

  test("(String) -> Int passes the string and returns a scalar", () => {
    expect(byteSource().$call("strLen", "héllo", Swift.closure((s: string) => s.length))).toBe(5);
  });

  test("(Int) -> String returns a synthesized string", () => {
    expect(byteSource().$call("label", 7, Swift.closure((n: number) => `n=${n}`))).toBe("n=7");
  });
});
