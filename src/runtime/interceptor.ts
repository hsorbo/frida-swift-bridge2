import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, SwiftValue } from "../abi/instance.js";
import { projectErrorExistential } from "../abi/existential.js";
import { shouldPassIndirectly, floatClass } from "./calling-convention.js";
import { symbolicate, parseSwiftSignature, resolveType } from "./symbolication.js";

export interface SwiftInvocationCallbacks {
  onEnter?: (this: InvocationContext, args: SwiftValue[]) => void;
  onLeave?: (this: InvocationContext, retval: SwiftValue, error?: SwiftValue) => void;
}

type TypePlan =
  | { generic: false; metadata: Metadata }
  | { generic: true; paramIndex: number };

interface CallShape {
  args: TypePlan[];
  ret: TypePlan | null;
  genericCount: number;
  throws: boolean;
}

function planType(name: string, genericParams: string[]): TypePlan {
  const paramIndex = genericParams.indexOf(name);
  if (paramIndex !== -1) {
    return { generic: true, paramIndex };
  }
  const metadata = resolveType(name);
  if (metadata === null) {
    throw new Error(`could not resolve type: ${name}`);
  }
  return { generic: false, metadata };
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
      genericCount: gp.length,
      throws: parsed.throws,
    };
  }

  const memberType = resolveType(parsed.typeName);
  if (memberType === null) {
    throw new Error(`could not resolve accessor type: ${symbol.demangled}`);
  }
  const member: TypePlan = { generic: false, metadata: memberType };
  switch (parsed.kind) {
    case "getter":
      return { args: [], ret: member, genericCount: 0, throws: false };
    case "setter":
      return { args: [member], ret: null, genericCount: 0, throws: false };
    default:
      throw new Error(`cannot hook a 'modify' accessor (coroutine ABI): ${symbol.demangled}`);
  }
}

function returnIsIndirect(ret: TypePlan | null): boolean {
  if (ret === null) {
    return false;
  }
  if (ret.generic) {
    return true;
  }
  const md = ret.metadata;
  return (
    md.valueWitnesses.size > 0 &&
    md.kind !== MetadataKind.Class &&
    floatClass(md) === null &&
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
  genericCount: number
): MaterializedArgs {
  let ngrn = 0;
  let nsrn = 0;
  const slots: { plan: TypePlan; address: NativePointer }[] = [];

  for (const plan of args) {
    if (plan.generic) {
      slots.push({ plan, address: gpr(context, ngrn++) });
      continue;
    }
    const metadata = plan.metadata;
    const cls = floatClass(metadata);
    if (cls !== null) {
      const scratch = Memory.alloc(8);
      const value = fpr(context, nsrn++, cls);
      cls === "double" ? scratch.writeDouble(value) : scratch.writeFloat(value);
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
  for (let i = 0; i < genericCount; i++) {
    generics.push(new Metadata(gpr(context, ngrn++)));
  }

  const values = slots.map((s) =>
    readValue(s.plan.generic ? generics[s.plan.paramIndex] : s.plan.metadata, s.address)
  );
  return { values, generics };
}

function materializeReturn(
  context: Arm64CpuContext,
  ret: TypePlan | null,
  indirectReturn: NativePointer | null,
  generics: Metadata[]
): SwiftValue {
  if (ret === null) {
    return null;
  }
  if (ret.generic) {
    if (indirectReturn === null) {
      throw new Error("indirect return address was not captured on enter");
    }
    return readValue(generics[ret.paramIndex], indirectReturn);
  }

  const returnType = ret.metadata;
  if (returnType.valueWitnesses.size === 0) {
    return null;
  }
  const cls = floatClass(returnType);
  if (cls !== null) {
    const scratch = Memory.alloc(8);
    cls === "double" ? scratch.writeDouble(context.d0) : scratch.writeFloat(context.s0);
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
  const { args, ret, genericCount, throws } = callShape(target);
  const captureIndirect = returnIsIndirect(ret);
  const retIsGeneric = ret?.generic === true;
  const wantsArgs = callbacks.onEnter !== undefined || retIsGeneric;

  const onEnter =
    wantsArgs || captureIndirect
      ? function (this: InvocationContext) {
          const context = this.context as Arm64CpuContext;
          const state = this as unknown as SwiftInvocationState;
          if (captureIndirect) {
            state.indirectReturn = context.x8;
          }
          if (wantsArgs) {
            const { values, generics } = materializeArgs(context, args, genericCount);
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
            materializeReturn(context, ret, state.indirectReturn ?? null, state.generics ?? [])
          );
        }
      : undefined;

  return Interceptor.attach(target, { onEnter, onLeave });
}

export interface SwiftInterceptorApi {
  attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener;
}

export const SwiftInterceptor: SwiftInterceptorApi = { attach };
