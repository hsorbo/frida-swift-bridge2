import { AsyncFunctionPointer } from "../abi/async-function-pointer.js";
import { AsyncTask } from "../abi/async-task.js";
import { projectErrorExistential } from "../abi/existential.js";
import { readValue, SwiftValue } from "../abi/instance.js";
import { LIBSWIFT_CORE_NAME, SWIFT_HOST_SUPPORTED } from "./platform.js";

const OFFSETOF_PARENT = 0;
const OFFSETOF_RESUME_PARENT = Process.pointerSize;

const ARG_REGS = ["x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7"] as Arm64Register[];
const GP_RESULT_REGS = ["x0", "x1", "x2", "x3"] as Arm64Register[];
const MAX_FLOAT_REGS = 8;

const COPY_TASK_LOCALS = 1 << 10;
const ENQUEUE_JOB = 1 << 12;
const OPERATION_CONTEXT_SIZE = 512;
const TRAMPOLINE_SIZE = 0x100;
const DEFAULT_TIMEOUT_MS = 1000;
const DISPATCH_TIME_FOREVER = uint64("0xffffffffffffffff");
const POLL_INTERVAL_MS = 5;

export type FloatClass = "double" | "float";

export type AsyncResultShape =
  | { kind: "gp"; words: number }
  | { kind: "float"; cls: FloatClass; count: number }
  | { kind: "indirect"; stride: number };

export interface AsyncFloatArg {
  bytes: NativePointer;
  cls: FloatClass;
}

export interface AsyncCallOptions {
  receiver?: NativePointer;
  throws?: boolean;
  floatArgs?: AsyncFloatArg[];
  result?: AsyncResultShape;
  timeoutMs?: number; // 0 waits forever
}

export class SwiftAsyncThrow extends Error {
  constructor(readonly value: SwiftValue) {
    super(`Swift async function threw: ${String(value)}`);
    this.name = "SwiftAsyncThrow";
  }
}

const CONCURRENCY_MODULE = Process.platform === "darwin" ? "libswift_Concurrency.dylib" : "libswift_Concurrency.so";
const DISPATCH_MODULE = Process.platform === "darwin" ? "libdispatch.dylib" : "libdispatch.so";

// find/getExportByName crash on libswift_Concurrency under Frida 17/Linux; cache enumerateExports instead.
const moduleExportTables = new Map<string, Map<string, NativePointer>>();
function moduleExport(moduleName: string, symbol: string): NativePointer {
  let exports = moduleExportTables.get(moduleName);
  if (exports === undefined) {
    exports = new Map();
    for (const e of Process.getModuleByName(moduleName).enumerateExports()) {
      exports.set(e.name, e.address);
    }
    moduleExportTables.set(moduleName, exports);
  }
  const p = exports.get(symbol);
  if (p === undefined) {
    throw new Error(`${moduleName}: no export ${symbol}`);
  }
  return p;
}

function concExport(name: string): NativePointer {
  return moduleExport(CONCURRENCY_MODULE, name);
}

// swift_task_getCurrent is SWIFT_CC(swift) with no formal args, so plain C ABI reaches it.
let getCurrentTask: (() => NativePointer) | null = null;
export function currentAsyncTask(): AsyncTask | null {
  if (!SWIFT_HOST_SUPPORTED) {
    throw new Error(`async introspection needs an arm64 Swift host, got ${Process.arch}/${Process.platform}`);
  }
  if (getCurrentTask === null) {
    getCurrentTask = new NativeFunction(concExport("swift_task_getCurrent"), "pointer", []) as unknown as () => NativePointer;
  }
  const task = getCurrentTask();
  return task.isNull() ? null : new AsyncTask(task);
}

function fpReg(cls: FloatClass, i: number): Arm64Register {
  return `${cls === "double" ? "d" : "s"}${i}` as Arm64Register;
}

function fpStride(cls: FloatClass): number {
  return cls === "double" ? 8 : 4;
}

function resultBufferSize(shape: AsyncResultShape): number {
  switch (shape.kind) {
    case "gp":
      return shape.words * Process.pointerSize;
    case "float":
      return Math.max(shape.count * fpStride(shape.cls), Process.pointerSize);
    case "indirect":
      return shape.stride;
  }
}

// Held for the task's lifetime so Frida keeps the trampoline pages and result buffers alive.
interface SynthesizedCall {
  operation: NativePointer;
  continuation: NativePointer;
  result: NativePointer;
  error: NativePointer;
  done: NativePointer;
}

// Two swiftasync trampolines (PAC stripped): `operation` allocates foo's frame, wires Parent/
// ResumeParent, loads args + self, and tail-calls foo; `continuation` captures the result/error, frees
// the frame, sets `done`, and returns through ourCtx.ResumeParent.
function synthesizeAsyncCall(afp: AsyncFunctionPointer, args: NativePointer[], options: AsyncCallOptions, signalSemaphore: NativePointer | null): SynthesizedCall {
  const shape: AsyncResultShape = options.result ?? { kind: "gp", words: 1 };
  const floatArgs = options.floatArgs ?? [];
  const gpBase = shape.kind === "indirect" ? 1 : 0;
  if (gpBase + args.length > ARG_REGS.length) {
    throw new Error("too many register arguments");
  }
  if (floatArgs.length > MAX_FLOAT_REGS) {
    throw new Error("too many floating-point arguments");
  }
  if (shape.kind === "gp" && (shape.words < 1 || shape.words > GP_RESULT_REGS.length)) {
    throw new Error("direct GP results wider than 4 words are not supported");
  }
  const swift_task_alloc = concExport("swift_task_alloc");
  const swift_task_dealloc = concExport("swift_task_dealloc");
  const dispatch_semaphore_signal = signalSemaphore !== null ? moduleExport(DISPATCH_MODULE, "dispatch_semaphore_signal") : null;
  const result = Memory.alloc(resultBufferSize(shape));
  const error = Memory.alloc(Process.pointerSize).writePointer(NULL);
  const done = Memory.alloc(Process.pointerSize);

  const continuation = Memory.alloc(Process.pageSize);
  Memory.patchCode(continuation, TRAMPOLINE_SIZE, (slot) => {
    const w = new Arm64Writer(slot, { pc: continuation });
    if (shape.kind === "gp") {
      w.putLdrRegAddress("x14", result);
      for (let i = 0; i < shape.words; i++) {
        w.putStrRegRegOffset(GP_RESULT_REGS[i], "x14", i * Process.pointerSize);
      }
    } else if (shape.kind === "float") {
      w.putLdrRegAddress("x14", result);
      for (let i = 0; i < shape.count; i++) {
        w.putStrRegRegOffset(fpReg(shape.cls, i), "x14", i * fpStride(shape.cls));
      }
    }
    if (options.throws === true) {
      w.putLdrRegAddress("x14", error);
      w.putStrRegRegOffset("x20", "x14", 0);
    }
    w.putPushRegReg("x29", "x30");
    w.putLdrRegRegOffset("x8", "x22", OFFSETOF_PARENT);
    w.putPushRegReg("x8", "x9"); // swift_task_dealloc clobbers x22
    w.putMovRegReg("x0", "x22");
    w.putLdrRegAddress("x14", swift_task_dealloc);
    w.putBlrRegNoAuth("x14");
    w.putLdrRegRegOffset("x22", "sp", 0);
    w.putPopRegReg("x8", "x9");
    w.putPopRegReg("x29", "x30");
    w.putLdrRegU64("x9", 1);
    w.putLdrRegAddress("x14", done);
    w.putStrRegRegOffset("x9", "x14", 0);
    if (dispatch_semaphore_signal !== null) {
      w.putPushRegReg("x22", "x30"); // preserve the async context across the call so ResumeParent survives
      w.putLdrRegAddress("x0", signalSemaphore!);
      w.putLdrRegAddress("x14", dispatch_semaphore_signal);
      w.putBlrRegNoAuth("x14");
      w.putPopRegReg("x22", "x30");
    }
    w.putLdrRegRegOffset("x1", "x22", OFFSETOF_RESUME_PARENT);
    w.putBrRegNoAuth("x1");
    w.flush();
  });

  const operation = Memory.alloc(Process.pageSize);
  Memory.patchCode(operation, TRAMPOLINE_SIZE, (slot) => {
    const w = new Arm64Writer(slot, { pc: operation });
    w.putPushRegReg("x29", "x30");
    w.putPushRegReg("x22", "x8"); // swift_task_alloc clobbers x22
    w.putLdrRegAddress("x0", ptr(afp.expectedContextSize));
    w.putLdrRegAddress("x14", swift_task_alloc);
    w.putBlrRegNoAuth("x14");
    w.putMovRegReg("x9", "x0");
    w.putLdrRegRegOffset("x8", "sp", 0);
    w.putStrRegRegOffset("x8", "x9", OFFSETOF_PARENT);
    w.putLdrRegAddress("x10", continuation);
    w.putStrRegRegOffset("x10", "x9", OFFSETOF_RESUME_PARENT);
    w.putPopRegReg("x22", "x8");
    w.putPopRegReg("x29", "x30");
    if (shape.kind === "indirect") {
      w.putLdrRegAddress("x0", result); // @out rides x0, not x8 as in sync swiftcc
    }
    args.forEach((a, i) => w.putLdrRegAddress(ARG_REGS[gpBase + i], a));
    floatArgs.forEach((fa, i) => {
      w.putLdrRegAddress("x14", fa.bytes);
      w.putLdrRegRegOffset(fpReg(fa.cls, i), "x14", 0);
    });
    if (options.receiver !== undefined) {
      w.putLdrRegAddress("x20", options.receiver);
    }
    w.putMovRegReg("x22", "x9");
    w.putLdrRegAddress("x14", afp.code);
    w.putBrRegNoAuth("x14");
    w.flush();
  });

  return { operation, continuation, result, error, done };
}

type CreateTask = (
  flags: number,
  options: NativePointer,
  resultType: NativePointer,
  operation: NativePointer,
  closureContext: NativePointer,
  contextSize: number
) => NativePointer[];

interface DriveApi {
  create: CreateTask;
  release: (task: NativePointer) => void;
  semaphoreCreate: (value: number) => NativePointer;
  semaphoreWait: (semaphore: NativePointer, timeout: UInt64) => number;
  time: (base: UInt64, delta: Int64) => UInt64;
}
let driveApi: DriveApi | null = null;
function getDriveApi(): DriveApi {
  if (driveApi !== null) {
    return driveApi;
  }
  if (!SWIFT_HOST_SUPPORTED) {
    throw new Error(`async calls need an arm64 Swift host, got ${Process.arch}/${Process.platform}`);
  }
  const g = (name: string) => moduleExport(DISPATCH_MODULE, name);
  driveApi = {
    create: new NativeFunction(concExport("swift_task_create_common"), ["pointer", "pointer"], [
      "size_t", "pointer", "pointer", "pointer", "pointer", "size_t",
    ]) as unknown as CreateTask,
    release: new NativeFunction(moduleExport(LIBSWIFT_CORE_NAME, "swift_release"), "void", ["pointer"]),
    semaphoreCreate: new NativeFunction(g("dispatch_semaphore_create"), "pointer", ["long"]),
    semaphoreWait: new NativeFunction(g("dispatch_semaphore_wait"), "long", ["pointer", "uint64"]),
    time: new NativeFunction(g("dispatch_time"), "uint64", ["uint64", "int64"]),
  };
  return driveApi;
}

function decodeThrownError(errorBox: NativePointer): SwiftValue {
  const container = Memory.alloc(Process.pointerSize).writePointer(errorBox);
  const { type, value } = projectErrorExistential(container);
  return readValue(type, value);
}

const abandoned = new Set<SynthesizedCall>();

function reapAbandoned(): void {
  for (const call of abandoned) {
    if (call.done.readU8() !== 0) {
      abandoned.delete(call);
    }
  }
}

// The continuation runs a few more instructions (frame dealloc + resume-parent branch) after it sets
// `done` and wakes us, so its page must not be freed the instant the call resolves — Frida recycling
// it under the still-running worker branches through rewritten code and segfaults. Root recent calls
// so a page outlives its worker by many generations.
const RETAINED_CALLS = 128;
const retained: SynthesizedCall[] = [];

function startCall(afp: AsyncFunctionPointer, args: NativePointer[], options: AsyncCallOptions, signalSemaphore: NativePointer | null): SynthesizedCall {
  const api = getDriveApi();
  reapAbandoned();
  const call = synthesizeAsyncCall(afp, args, options, signalSemaphore);
  retained.push(call);
  if (retained.length > RETAINED_CALLS) {
    retained.shift();
  }
  const task = api.create(ENQUEUE_JOB | COPY_TASK_LOCALS, NULL, NULL, call.operation, NULL, OPERATION_CONTEXT_SIZE)[0];
  if (task.isNull()) {
    throw new Error("swift_task_create_common failed");
  }
  api.release(task); // swift_task_create returns +1; enqueue holds its own ref, so drop ours (detached task)
  return call;
}

// The continuation trampoline signals this on completion; a timed-out wait restores its own count, so
// each call consumes exactly one signal and the single semaphore stays balanced across calls.
let waitSemaphore: NativePointer | null = null;
function getWaitSemaphore(api: DriveApi): NativePointer {
  if (waitSemaphore === null) {
    waitSemaphore = api.semaphoreCreate(0);
  }
  return waitSemaphore;
}

function takeResult(call: SynthesizedCall): NativePointer {
  const thrown = call.error.readPointer();
  if (!thrown.isNull()) {
    throw new SwiftAsyncThrow(decodeThrownError(thrown));
  }
  return call.result;
}

// Block on a dispatch semaphore (not a plain sleep) so libdispatch keeps servicing the executor; the
// continuation signals it, so a completed task wakes us the moment it finishes.
export function driveAsyncCall(afp: AsyncFunctionPointer, args: NativePointer[], options: AsyncCallOptions = {}): NativePointer {
  const api = getDriveApi();
  const semaphore = getWaitSemaphore(api);
  const call = startCall(afp, args, options, semaphore);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = timeoutMs === 0 ? DISPATCH_TIME_FOREVER : api.time(uint64(0), int64(timeoutMs * 1_000_000));
  while (call.done.readU8() === 0) {
    const timedOut = Number(api.semaphoreWait(semaphore, deadline)) !== 0;
    if (call.done.readU8() !== 0) break;
    if (timedOut) {
      abandoned.add(call); // root it: a late task may still run these trampolines
      throw new Error("async call did not complete");
    }
    // a stray signal from a late abandoned task on the shared semaphore woke us early; keep waiting
  }
  return takeResult(call);
}

export function callAsync(afp: AsyncFunctionPointer, args: NativePointer[], options: AsyncCallOptions = {}): Promise<NativePointer> {
  return new Promise((resolve, reject) => {
    let call: SynthesizedCall;
    try {
      call = startCall(afp, args, options, null);
    } catch (e) {
      reject(e);
      return;
    }
    const poll = (): void => {
      if (call.done.readU8() === 0) {
        setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      try {
        resolve(takeResult(call));
      } catch (e) {
        reject(e);
      }
    };
    poll();
  });
}
