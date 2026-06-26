import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, SwiftValue } from "../abi/instance.js";
import { projectErrorExistential } from "../abi/existential.js";
import { shouldPassIndirectly, floatLayout } from "./calling-convention.js";
import { symbolicate, parseSwiftSignature, resolveType, resolveTypeExpr } from "./symbolication.js";

export interface SwiftInvocationCallbacks {
  onEnter?: (this: InvocationContext, args: SwiftValue[]) => void;
  onLeave?: (this: InvocationContext, retval: SwiftValue, error?: SwiftValue) => void;
}

type TypePlan =
  | { kind: "concrete"; metadata: Metadata }
  | { kind: "param"; paramIndex: number }
  | { kind: "use"; expr: string }; // param-referencing expression: A?, [A], Array<A>

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
  if (genericParams.some((p) => new RegExp(`\\b${p}\\b`).test(name))) {
    return { kind: "use", expr: name };
  }
  throw new Error(`could not resolve type: ${name}`);
}

function planMetadata(plan: TypePlan, generics: Metadata[], genericParams: string[]): Metadata {
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

function returnIsIndirect(ret: TypePlan | null): boolean {
  if (ret === null) {
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
  genericParams: string[]
): MaterializedArgs {
  let ngrn = 0;
  let nsrn = 0;
  const slots: { plan: TypePlan; address: NativePointer }[] = [];

  for (const plan of args) {
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
    readValue(planMetadata(s.plan, generics, genericParams), s.address)
  );
  return { values, generics };
}

function materializeReturn(
  context: Arm64CpuContext,
  ret: TypePlan | null,
  indirectReturn: NativePointer | null,
  generics: Metadata[],
  genericParams: string[]
): SwiftValue {
  if (ret === null) {
    return null;
  }
  if (isIndirectPlan(ret)) {
    if (indirectReturn === null) {
      throw new Error("indirect return address was not captured on enter");
    }
    return readValue(planMetadata(ret, generics, genericParams), indirectReturn);
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
    return readValue(returnType, Memory.alloc(8).writePointer(context.x0));
  }
  if (shouldPassIndirectly(returnType)) {
    if (indirectReturn === null) {
      throw new Error("indirect return address was not captured on enter");
    }
    return readValue(returnType, indirectReturn);
  }

  const count = words(returnType);
  const scratch = Memory.alloc(Math.max(count, 1) * 8);
  const regs = context as unknown as Record<string, NativePointer>;
  for (let w = 0; w < count; w++) {
    scratch.add(w * 8).writePointer(regs[`x${w}`]);
  }
  return readValue(returnType, scratch);
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

export interface SwiftInterceptorApi {
  attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener;
}

export const SwiftInterceptor: SwiftInterceptorApi = { attach };
