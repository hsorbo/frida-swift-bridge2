import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, embedsManagedReference, SwiftValue } from "../abi/instance.js";
import { ValueInstance } from "../abi/value.js";
import { ClassInstance } from "../abi/heap-object.js";
import { projectErrorExistential } from "../abi/existential.js";
import { shouldPassIndirectly, floatLayout } from "./calling-convention.js";
import { AsyncFunctionPointer, isAsyncFunctionPointerSymbol } from "../abi/async-function-pointer.js";
import { AsyncContext } from "../abi/async-context.js";
import { symbolicate, parseSwiftSignature, resolveType, resolveTypeExpr } from "./symbolication.js";
import { typeName } from "./type-name.js";
import { createObject } from "./object-facade.js";
import { CallResult } from "./method.js";

export interface SwiftInvocationCallbacks {
  onEnter?: (this: InvocationContext, args: SwiftValue[]) => void;
  onLeave?: (this: InvocationContext, retval: CallResult, error?: SwiftValue) => void;
}

type TypePlan =
  | { kind: "concrete"; metadata: Metadata }
  | { kind: "param"; paramIndex: number }
  | { kind: "use"; expr: string } // param-referencing expression: A?, [A], Array<A>
  | { kind: "metatype" }; // T.Type: one GP holding the metadata pointer directly (loadable POD)

interface CallShape {
  args: TypePlan[];
  ret: TypePlan | null;
  genericParams: string[];
  throws: boolean;
}

function planType(name: string, genericParams: string[]): TypePlan {
  const paramIndex = genericParams.indexOf(name);
  if (paramIndex !== -1) {
    return { kind: "param", paramIndex };
  }
  const metadata = resolveType(name);
  if (metadata !== null) {
    return { kind: "concrete", metadata };
  }
  if (name.endsWith(".Type")) {
    return { kind: "metatype" };
  }
  if (genericParams.some((p) => new RegExp(`\\b${p}\\b`).test(name))) {
    return { kind: "use", expr: name };
  }
  throw new Error(`could not resolve type: ${name}`);
}

function planMetadata(
  plan: Exclude<TypePlan, { kind: "metatype" }>,
  generics: Metadata[],
  genericParams: string[]
): Metadata {
  switch (plan.kind) {
    case "concrete":
      return plan.metadata;
    case "param":
      return generics[plan.paramIndex];
    case "use": {
      const metadata = resolveTypeExpr(plan.expr, (name) => {
        const i = genericParams.indexOf(name);
        return i >= 0 ? generics[i] : null;
      });
      if (metadata === null) {
        throw new Error(`could not resolve generic use: ${plan.expr}`);
      }
      return metadata;
    }
  }
}

// param/use values are address-only → passed indirectly (one GP pointer, or x8 for a return).
function isIndirectPlan(
  plan: TypePlan
): plan is { kind: "param"; paramIndex: number } | { kind: "use"; expr: string } {
  return plan.kind === "param" || plan.kind === "use";
}

function callShape(target: NativePointer): CallShape {
  const symbol = symbolicate(target);
  if (symbol === null) {
    throw new Error(`no Swift symbol at ${target}`);
  }
  const parsed = parseSwiftSignature(symbol.demangled);
  if (parsed === null) {
    throw new Error(`could not parse signature: ${symbol.demangled}`);
  }

  if (parsed.kind === "function") {
    if (parsed.genericParams.length > 0 && !parsed.simpleGenerics) {
      throw new Error(`unsupported generic signature: ${symbol.demangled}`);
    }
    const gp = parsed.genericParams;
    return {
      args: parsed.argTypeNames.map((n) => planType(n, gp)),
      ret: parsed.returnTypeName === null ? null : planType(parsed.returnTypeName, gp),
      genericParams: gp,
      throws: parsed.throws,
    };
  }

  const memberType = resolveType(parsed.typeName);
  if (memberType === null) {
    throw new Error(`could not resolve accessor type: ${symbol.demangled}`);
  }
  const member: TypePlan = { kind: "concrete", metadata: memberType };
  switch (parsed.kind) {
    case "getter":
      return { args: [], ret: member, genericParams: [], throws: false };
    case "setter":
      return { args: [member], ret: null, genericParams: [], throws: false };
    default:
      throw new Error(`cannot hook a 'modify' accessor (coroutine ABI): ${symbol.demangled}`);
  }
}

// A metatype value is the type-metadata pointer itself, surfaced as its qualified name.
function decodeMetatype(metadataPointer: NativePointer): SwiftValue {
  return typeName(new Metadata(metadataPointer));
}

function returnIsIndirect(ret: TypePlan | null): boolean {
  if (ret === null) {
    return false;
  }
  if (ret.kind === "metatype") {
    return false;
  }
  if (isIndirectPlan(ret)) {
    return true;
  }
  const md = ret.metadata;
  return (
    md.valueWitnesses.size > 0 &&
    md.kind !== MetadataKind.Class &&
    floatLayout(md) === null &&
    shouldPassIndirectly(md)
  );
}

function gpr(context: Arm64CpuContext, n: number): NativePointer {
  if (n > 7) {
    throw new Error("stack arguments are not supported");
  }
  return (context as unknown as Record<string, NativePointer>)[`x${n}`];
}

function fpr(context: Arm64CpuContext, n: number, cls: "double" | "float"): number {
  if (n > 7) {
    throw new Error("stack floating-point arguments are not supported");
  }
  return (context as unknown as Record<string, number>)[`${cls === "double" ? "d" : "s"}${n}`];
}

function words(metadata: Metadata): number {
  return Math.ceil(metadata.valueWitnesses.size / 8);
}

interface MaterializedArgs {
  values: SwiftValue[];
  generics: Metadata[];
}

// Generic metadata follows the formal args in the GP sequence, so decode after walking them.
function materializeArgs(
  context: Arm64CpuContext,
  args: TypePlan[],
  genericParams: string[],
  startReg = 0
): MaterializedArgs {
  let ngrn = startReg;
  let nsrn = 0;
  const slots: { plan: TypePlan; address: NativePointer }[] = [];

  for (const plan of args) {
    if (plan.kind === "metatype") {
      slots.push({ plan, address: gpr(context, ngrn++) }); // address IS the metadata pointer
      continue;
    }
    if (isIndirectPlan(plan)) {
      slots.push({ plan, address: gpr(context, ngrn++) });
      continue;
    }
    const metadata = plan.metadata;
    const fl = floatLayout(metadata);
    if (fl !== null) {
      const stride = fl.cls === "double" ? 8 : 4;
      const scratch = Memory.alloc(Math.max(fl.count * stride, 8));
      for (let k = 0; k < fl.count; k++) {
        const leaf = scratch.add(k * stride);
        const value = fpr(context, nsrn++, fl.cls);
        fl.cls === "double" ? leaf.writeDouble(value) : leaf.writeFloat(value);
      }
      slots.push({ plan, address: scratch });
    } else if (metadata.kind === MetadataKind.Class) {
      slots.push({ plan, address: Memory.alloc(8).writePointer(gpr(context, ngrn++)) });
    } else if (shouldPassIndirectly(metadata)) {
      slots.push({ plan, address: gpr(context, ngrn++) });
    } else {
      const count = words(metadata);
      const scratch = Memory.alloc(Math.max(count, 1) * 8);
      for (let w = 0; w < count; w++) {
        scratch.add(w * 8).writePointer(gpr(context, ngrn++));
      }
      slots.push({ plan, address: scratch });
    }
  }

  const generics: Metadata[] = [];
  for (let i = 0; i < genericParams.length; i++) {
    generics.push(new Metadata(gpr(context, ngrn++)));
  }

  const values = slots.map((s) =>
    s.plan.kind === "metatype"
      ? decodeMetatype(s.address)
      : readValue(planMetadata(s.plan, generics, genericParams), s.address)
  );
  return { values, generics };
}

// Mirrors method.ts decodeReturn, but borrows: an interceptor only observes the caller's +1, so it
// neither adopts nor destroys. A non-POD value embedding a managed reference can't be deep-copied
// out, so it surfaces as a live facade over the borrowed storage, valid for the callback's duration;
// everything else stays a snapshot. The borrowed address is the caller's storage, so writing through
// it edits the return.
function decodeReturnValue(metadata: Metadata, address: NativePointer): CallResult {
  if (!metadata.valueWitnesses.isPOD && embedsManagedReference(metadata)) {
    return createObject(ValueInstance.borrow(metadata, address));
  }
  return readValue(metadata, address);
}

function materializeReturn(
  context: Arm64CpuContext,
  ret: TypePlan | null,
  indirectReturn: NativePointer | null,
  generics: Metadata[],
  genericParams: string[]
): CallResult {
  if (ret === null) {
    return null;
  }
  if (ret.kind === "metatype") {
    return decodeMetatype(context.x0);
  }
  if (isIndirectPlan(ret)) {
    if (indirectReturn === null) {
      throw new Error("indirect return address was not captured on enter");
    }
    return decodeReturnValue(planMetadata(ret, generics, genericParams), indirectReturn);
  }

  const returnType = ret.metadata;
  if (returnType.valueWitnesses.size === 0) {
    return null;
  }
  const fl = floatLayout(returnType);
  if (fl !== null) {
    const stride = fl.cls === "double" ? 8 : 4;
    const scratch = Memory.alloc(Math.max(fl.count * stride, 8));
    const regs = context as unknown as Record<string, number>;
    for (let k = 0; k < fl.count; k++) {
      const leaf = scratch.add(k * stride);
      const value = regs[`${fl.cls === "double" ? "d" : "s"}${k}`];
      fl.cls === "double" ? leaf.writeDouble(value) : leaf.writeFloat(value);
    }
    return readValue(returnType, scratch);
  }
  if (returnType.kind === MetadataKind.Class) {
    return createObject(new ClassInstance(context.x0));
  }
  if (shouldPassIndirectly(returnType)) {
    if (indirectReturn === null) {
      throw new Error("indirect return address was not captured on enter");
    }
    return decodeReturnValue(returnType, indirectReturn);
  }

  // Direct multi-register return: the bytes live only in x0..xN, so a non-POD value is borrowed over
  // this private reassembly — readable/callable in the callback, but not write-through to the caller.
  const count = words(returnType);
  const scratch = Memory.alloc(Math.max(count, 1) * 8);
  const regs = context as unknown as Record<string, NativePointer>;
  for (let w = 0; w < count; w++) {
    scratch.add(w * 8).writePointer(regs[`x${w}`]);
  }
  return decodeReturnValue(returnType, scratch);
}

function decodeThrownError(errorBox: NativePointer): SwiftValue {
  const container = Memory.alloc(Process.pointerSize);
  container.writePointer(errorBox);
  const { type, value } = projectErrorExistential(container);
  return readValue(type, value);
}

interface SwiftInvocationState {
  indirectReturn?: NativePointer;
  generics?: Metadata[];
}

function attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener {
  const { args, ret, genericParams, throws } = callShape(target);
  const captureIndirect = returnIsIndirect(ret);
  const returnNeedsGenerics = ret !== null && isIndirectPlan(ret) && genericParams.length > 0;
  const wantsArgs = callbacks.onEnter !== undefined || returnNeedsGenerics;

  const onEnter =
    wantsArgs || captureIndirect
      ? function (this: InvocationContext) {
          const context = this.context as Arm64CpuContext;
          const state = this as unknown as SwiftInvocationState;
          if (captureIndirect) {
            state.indirectReturn = context.x8;
          }
          if (wantsArgs) {
            const { values, generics } = materializeArgs(context, args, genericParams);
            state.generics = generics;
            if (callbacks.onEnter !== undefined) {
              callbacks.onEnter.call(this, values);
            }
          }
        }
      : undefined;

  const onLeave =
    callbacks.onLeave !== undefined
      ? function (this: InvocationContext) {
          const context = this.context as Arm64CpuContext;
          const state = this as unknown as SwiftInvocationState;
          const swiftErrorRegister = context.x21; // swiftcc returns a thrown error here
          if (throws && !swiftErrorRegister.isNull()) {
            callbacks.onLeave!.call(this, null, decodeThrownError(swiftErrorRegister));
            return;
          }
          callbacks.onLeave!.call(
            this,
            materializeReturn(
              context,
              ret,
              state.indirectReturn ?? null,
              state.generics ?? [],
              genericParams
            )
          );
        }
      : undefined;

  return Interceptor.attach(target, { onEnter, onLeave });
}

export interface SwiftAsyncCallbacks {
  onEnter?: (this: InvocationContext, args: SwiftValue[], context: NativePointer) => void;
  // The entry partial function returning: reached the first suspension, not logical completion.
  onFirstSuspend?: (this: InvocationContext) => void;
  onComplete?: (this: InvocationContext, retval: CallResult, error?: SwiftValue) => void;
}

function resolveAsyncEntry(target: NativePointer): NativePointer {
  const symbol = symbolicate(target);
  if (symbol !== null && isAsyncFunctionPointerSymbol(symbol.name)) {
    return new AsyncFunctionPointer(target).code;
  }
  return target;
}

interface CompletionEntry {
  callbacks: SwiftAsyncCallbacks;
  ret: TypePlan | null;
  generics: Metadata[];
  genericParams: string[];
  outBuffer: NativePointer | null;
  throws: boolean;
  cancelled: boolean;
  owner: Set<CompletionEntry>;
}

interface CompletionSlot {
  original: NativePointer;
  entries: CompletionEntry[];
}

// Completions are observed by redirecting the frame's ResumeParent (a data pointer) at one persistent
// capture trampoline, never by patching the live resumeParent page: patching code a completing worker
// is already about to execute on another core races its I-cache and silently drops the hook.
const pending = new Map<string, CompletionSlot>();
const COMPLETION_TRAMPOLINE_SIZE = 0x200;
let completionTrampoline: NativePointer | null = null;
let completionBridge: NativeCallback<"pointer", ["pointer", "pointer"]> | null = null;

function spillContext(spillPtr: NativePointer): Arm64CpuContext {
  const ctx: Record<string, NativePointer | number> = {};
  for (let i = 0; i < 8; i++) {
    ctx[`x${i}`] = spillPtr.add(i * 8).readPointer();
  }
  for (let i = 0; i < 8; i++) {
    const at = spillPtr.add(0x40 + i * 8);
    ctx[`d${i}`] = at.readDouble();
    ctx[`s${i}`] = at.readFloat();
  }
  ctx.x20 = spillPtr.add(0x80).readPointer();
  return ctx as unknown as Arm64CpuContext;
}

function fireCompletion(entry: CompletionEntry, spillPtr: NativePointer, invocationThis: InvocationContext): void {
  const context = spillContext(spillPtr);
  if (entry.throws && !context.x20.isNull()) {
    entry.callbacks.onComplete!.call(invocationThis, null, decodeThrownError(context.x20));
    return;
  }
  entry.callbacks.onComplete!.call(
    invocationThis,
    materializeReturn(context, entry.ret, entry.outBuffer, entry.generics, entry.genericParams)
  );
}

// x22 (context) and x20 (error) are AAPCS callee-saved, so the bridge call preserves them for the tail
// branch; x0..x7/d0..d7 hold the result and are caller-saved, so spill them for readback afterwards.
function getCompletionTrampoline(): NativePointer {
  if (completionTrampoline !== null) {
    return completionTrampoline;
  }
  completionBridge = new NativeCallback(function (this: CallbackContext, context: NativePointer, spillPtr: NativePointer): NativePointer {
    const key = context.toString();
    const slot = pending.get(key)!;
    pending.delete(key);
    const invocationThis = this as unknown as InvocationContext;
    for (const entry of slot.entries) {
      entry.owner.delete(entry);
      if (!entry.cancelled) {
        fireCompletion(entry, spillPtr, invocationThis);
      }
    }
    return slot.original;
  }, "pointer", ["pointer", "pointer"]);

  const page = Memory.alloc(Process.pageSize);
  Memory.patchCode(page, COMPLETION_TRAMPOLINE_SIZE, (slot) => {
    const w = new Arm64Writer(slot, { pc: page });
    w.putPushRegReg("x29", "x30");
    w.putSubRegRegImm("sp", "sp", 0x90);
    for (let i = 0; i < 8; i++) {
      w.putStrRegRegOffset(`x${i}` as Arm64Register, "sp", i * 8);
    }
    for (let i = 0; i < 8; i++) {
      w.putStrRegRegOffset(`d${i}` as Arm64Register, "sp", 0x40 + i * 8);
    }
    w.putStrRegRegOffset("x20", "sp", 0x80);
    w.putMovRegReg("x0", "x22");
    w.putAddRegRegImm("x1", "sp", 0);
    w.putLdrRegAddress("x14", completionBridge!);
    w.putBlrRegNoAuth("x14");
    w.putMovRegReg("x9", "x0");
    for (let i = 0; i < 8; i++) {
      w.putLdrRegRegOffset(`x${i}` as Arm64Register, "sp", i * 8);
    }
    for (let i = 0; i < 8; i++) {
      w.putLdrRegRegOffset(`d${i}` as Arm64Register, "sp", 0x40 + i * 8);
    }
    w.putAddRegRegImm("sp", "sp", 0x90);
    w.putPopRegReg("x29", "x30");
    w.putBrRegNoAuth("x9");
    w.flush();
  });
  completionTrampoline = page;
  return page;
}

function attachAsync(target: NativePointer, callbacks: SwiftAsyncCallbacks): InvocationListener {
  if (callbacks.onEnter === undefined && callbacks.onFirstSuspend === undefined && callbacks.onComplete === undefined) {
    throw new Error("attachAsync requires onEnter, onFirstSuspend, or onComplete");
  }
  const code = resolveAsyncEntry(target);
  const { args, ret, genericParams, throws } = callShape(code);

  const wantsCompletion = callbacks.onComplete !== undefined;
  const indirectReturn = returnIsIndirect(ret);
  const argRegBase = indirectReturn ? 1 : 0; // an @out result takes x0
  const returnNeedsGenerics = wantsCompletion && ret !== null && isIndirectPlan(ret) && genericParams.length > 0;
  const wantsArgs = callbacks.onEnter !== undefined || returnNeedsGenerics;
  const liveEntries = new Set<CompletionEntry>();

  const armCompletion = (context: Arm64CpuContext, generics: Metadata[]): void => {
    const trampoline = getCompletionTrampoline();
    const taskContext = context.x22;
    const ctx = new AsyncContext(taskContext);
    const key = taskContext.toString();
    let slot = pending.get(key);
    if (slot === undefined) {
      slot = { original: ctx.resumeParent, entries: [] };
      pending.set(key, slot);
      ctx.setResumeParent(trampoline);
    }
    const entry: CompletionEntry = {
      callbacks,
      ret,
      generics,
      genericParams,
      outBuffer: indirectReturn ? context.x0 : null,
      throws,
      cancelled: false,
      owner: liveEntries,
    };
    slot.entries.push(entry);
    liveEntries.add(entry);
  };

  const onEnter =
    wantsArgs || wantsCompletion
      ? function (this: InvocationContext) {
          const context = this.context as Arm64CpuContext;
          let generics: Metadata[] = [];
          if (wantsArgs) {
            const materialized = materializeArgs(context, args, genericParams, argRegBase);
            generics = materialized.generics;
            if (callbacks.onEnter !== undefined) {
              callbacks.onEnter.call(this, materialized.values, context.x22);
            }
          }
          if (wantsCompletion) {
            armCompletion(context, generics);
          }
        }
      : undefined;

  let entryListener: InvocationListener;
  if (callbacks.onFirstSuspend !== undefined) {
    const onFirstSuspend = callbacks.onFirstSuspend;
    entryListener = Interceptor.attach(code, {
      onEnter,
      onLeave: function (this: InvocationContext) {
        onFirstSuspend.call(this);
      },
    });
  } else {
    // onEnter-only: a bare function is a probe listener, which never traps the return.
    entryListener = Interceptor.attach(code, onEnter!);
  }

  if (!wantsCompletion) {
    return entryListener;
  }
  return {
    detach() {
      entryListener.detach();
      for (const entry of liveEntries) {
        entry.cancelled = true;
      }
      liveEntries.clear();
    },
  };
}

export interface SwiftInterceptorApi {
  attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener;
  attachAsync(target: NativePointer, callbacks: SwiftAsyncCallbacks): InvocationListener;
}

export const SwiftInterceptor: SwiftInterceptorApi = { attach, attachAsync };
