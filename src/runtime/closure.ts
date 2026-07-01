import { getSwiftCoreApi } from "./api.js";

// HeapObject header: [metadata, refCounts]. swift_allocObject installs strong count 1.
const HEAP_HEADER_SIZE = Process.pointerSize * 2;
const HEAP_ALIGN_MASK = Process.pointerSize - 1;

type AnyNativeCallback = NativeCallback<NativeCallbackReturnType, NativeCallbackArgumentType[]>;

export interface UnsafeRawBufferPointer {
  readonly base: NativePointer;
  readonly count: number;
  readBytes(): ArrayBuffer;
}

// result is the @out buffer (x8); returning a pointer throws it as a Swift error.
export type ClosureBody = (buffer: UnsafeRawBufferPointer, result: NativePointer) => NativePointer | void;

// Returned by a body to throw: the error becomes swifterror (x21). A class, so it can't be mistaken
// for a NativePointer result.
export class SwiftThrow {
  constructor(readonly error: NativePointer) {}
}

// Loadable closure: params arrive in registers (Frida marshals them to JS), result returns in x0/d0.
export type LoadableValue = number | boolean | NativePointer | Int64 | UInt64;
export type LoadableClosureBody = (...args: LoadableValue[]) => LoadableValue | SwiftThrow | void;

export type LoadableIndirectBody = (args: LoadableValue[], result: NativePointer) => SwiftThrow | void;

export type AnyClosureBody = (...args: any[]) => any;

// Deferred closure request: the ABI shape (loadable vs buffer, result routing) is known only at
// marshal time, so hold just the body until then.
export class ClosureSpec {
  constructor(readonly body: AnyClosureBody) {}
}

export function closure(body: AnyClosureBody): ClosureSpec {
  return new ClosureSpec(body);
}

interface ClosureResources {
  callback: AnyNativeCallback;
  code: NativePointer;
  slots: NativePointer;
  // populated by allocContext; held only to keep the context metadata + destroy callback alive
  metadata?: NativePointer;
  destroy?: AnyNativeCallback;
}

// Pins each closure's resources from creation until Swift's final release fires its destroy.
// Frida frees a NativeCallback / Memory.alloc when its NativePointer is unreferenced; the raw
// pointers baked into the trampoline page and context metadata do not count as references.
const liveResources = new Set<ClosureResources>();

export class SwiftClosure {
  readonly fnPointer: NativePointer;
  // Heap-object context Swift retains/releases like any closure capture (passed in x20 on invoke,
  // ignored by our trampoline). Owned at +1; released when this wrapper is collected.
  readonly context: NativePointer;

  private constructor(resources: ClosureResources) {
    this.fnPointer = resources.code;
    this.context = allocContext(resources);
    liveResources.add(resources);
    const release = getSwiftCoreApi().swift_release;
    const context = this.context;
    Script.bindWeak(this, () => {
      release(context);
    });
  }

  value(): NativePointer {
    const buffer = Memory.alloc(Process.pointerSize * 2);
    buffer.writePointer(this.fnPointer);
    buffer.add(Process.pointerSize).writePointer(this.context);
    return buffer;
  }

  static overBytes(fn: ClosureBody, options: { throws?: boolean } = {}): SwiftClosure {
    const slots = Memory.alloc(Process.pointerSize * 2);
    const resultSlot = slots;
    const errorSlot = slots.add(Process.pointerSize);
    const callback = new NativeCallback(
      // UnsafeRawBufferPointer arrives as (base, end), not (base, count)
      (base: NativePointer, end: NativePointer) => {
        const count = end.sub(base).toUInt32();
        const error = fn(
          {
            base,
            count,
            readBytes: () => base.readByteArray(count) ?? new ArrayBuffer(0),
          },
          resultSlot.readPointer()
        );
        errorSlot.writePointer(error ?? ptr(0));
      },
      "void",
      ["pointer", "pointer"]
    );
    const code = Memory.alloc(Process.pageSize);
    writeClosureTrampoline(code, {
      target: callback as NativePointer,
      resultSlot,
      errorSlot,
      routesError: options.throws === true,
    });
    return new SwiftClosure({ callback, code, slots });
  }

  // Loadable params and a loadable/Void result match the C ABI a NativeCallback already speaks
  // (swiftself in x20 and swifterror in x21 are the only swiftcc extras, both irrelevant to a
  // non-throwing direct-result closure), so the signed callback itself is the closure function.
  // Throwing needs the trampoline: only asm can set x21.
  static loadable(
    body: LoadableClosureBody,
    paramTypes: NativeCallbackArgumentType[],
    resultType: NativeCallbackReturnType,
    options: { throws?: boolean } = {}
  ): SwiftClosure {
    if (options.throws !== true) {
      const callback = new NativeCallback(
        ((...args: LoadableValue[]) => coerceResult(body(...args))) as never,
        resultType,
        paramTypes
      ) as AnyNativeCallback;
      return new SwiftClosure({ callback, code: callback as unknown as NativePointer, slots: ptr(0) });
    }

    const errorSlot = Memory.alloc(Process.pointerSize);
    const callback = new NativeCallback(
      ((...args: LoadableValue[]): LoadableValue => {
        const r = body(...args);
        errorSlot.writePointer(r instanceof SwiftThrow ? r.error : ptr(0));
        return r instanceof SwiftThrow ? 0 : coerceResult(r);
      }) as never,
      resultType,
      paramTypes
    ) as AnyNativeCallback;
    const code = Memory.alloc(Process.pageSize);
    writeClosureTrampoline(code, { target: callback as NativePointer, resultSlot: null, errorSlot, routesError: true });
    return new SwiftClosure({ callback, code, slots: errorSlot });
  }

  // Like loadable, but the result is written through x8 (stashed by the trampoline), as in overBytes.
  static loadableProducing(
    body: LoadableIndirectBody,
    paramTypes: NativeCallbackArgumentType[],
    options: { throws?: boolean } = {}
  ): SwiftClosure {
    const slots = Memory.alloc(Process.pointerSize * 2);
    const resultSlot = slots;
    const errorSlot = slots.add(Process.pointerSize);
    const callback = new NativeCallback(
      ((...args: LoadableValue[]) => {
        const r = body(args, resultSlot.readPointer());
        errorSlot.writePointer(r instanceof SwiftThrow ? r.error : ptr(0));
      }) as never,
      "void",
      paramTypes
    ) as AnyNativeCallback;
    const code = Memory.alloc(Process.pageSize);
    writeClosureTrampoline(code, { target: callback as NativePointer, resultSlot, errorSlot, routesError: options.throws === true });
    return new SwiftClosure({ callback, code, slots });
  }
}

function coerceResult(r: LoadableValue | SwiftThrow | void): LoadableValue {
  return typeof r === "boolean" ? (r ? 1 : 0) : (r as LoadableValue) ?? 0;
}

// Builds the refcounted context. FullMetadata<HeapMetadata> lays the heap-metadata header at
// negative offsets: [layoutString @M-24][destroy @M-16][vwt @M-8][kind @M]. Only `destroy` is read
// on the release path (kind/vwt/layoutString are not), so the synthesized metadata sets just it.
function allocContext(resources: ClosureResources): NativePointer {
  const api = getSwiftCoreApi();
  const block = Memory.alloc(Process.pointerSize * 4);
  const metadata = block.add(Process.pointerSize * 3);
  metadata.writeU64(0x400); // HeapLocalVariable kind, defensive; never consulted on retain/release.
  resources.metadata = block;

  let context = ptr(0);
  const destroy = new NativeCallback(
    () => {
      liveResources.delete(resources);
      api.swift_deallocObject(context, HEAP_HEADER_SIZE, HEAP_ALIGN_MASK);
    },
    "void",
    []
  );
  resources.destroy = destroy;
  // The destroy slot (metadata-16) is stored unsigned; swift_release calls it raw on this runtime.
  metadata.sub(Process.pointerSize * 2).writePointer(destroy);

  context = api.swift_allocObject(metadata, HEAP_HEADER_SIZE, HEAP_ALIGN_MASK) as NativePointer;
  return context;
}

interface ClosureTrampolineConfig {
  target: NativePointer;
  resultSlot: NativePointer | null; // null ⇒ no x8 stash (result rides in registers)
  errorSlot: NativePointer;
  routesError: boolean;
}

// Swift branches in; stash x8 (the @out result) for the callback, then route its error to x21.
// x21 is swifterror only when the closure throws — otherwise it's callee-saved and left untouched.
function writeClosureTrampoline(code: NativePointer, cfg: ClosureTrampolineConfig): void {
  Memory.patchCode(code, 0x80, (slot) => {
    const writer = new Arm64Writer(slot, { pc: code });

    writer.putPushRegReg("x29", "x30");

    if (cfg.resultSlot !== null) {
      writer.putLdrRegAddress("x15", cfg.resultSlot);
      writer.putStrRegRegOffset("x8", "x15", 0);
    }

    writer.putLdrRegAddress("x14", cfg.target);
    writer.putBlrRegNoAuth("x14");

    if (cfg.routesError) {
      writer.putLdrRegAddress("x15", cfg.errorSlot);
      writer.putLdrRegRegOffset("x21", "x15", 0);
    }

    writer.putPopRegReg("x29", "x30");
    writer.putRet();

    writer.flush();
  });
}
