import { Metadata, MetadataKind } from "../abi/metadata.js";
import { readValue, SwiftValue } from "../abi/instance.js";
import { shouldPassIndirectly, floatClass } from "./calling-convention.js";
import {
  symbolicate,
  parseSwiftSignature,
  resolveFunctionSignature,
  resolveType,
} from "./symbolication.js";

export interface SwiftInvocationCallbacks {
  onEnter?: (this: InvocationContext, args: SwiftValue[]) => void;
  onLeave?: (this: InvocationContext, retval: SwiftValue) => void;
}

interface CallShape {
  argTypes: Metadata[];
  returnType: Metadata | null;
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
    const resolved = resolveFunctionSignature(parsed);
    if (resolved === null) {
      throw new Error(`could not resolve types in: ${symbol.demangled}`);
    }
    return { argTypes: resolved.argTypes, returnType: resolved.returnType };
  }

  const memberType = resolveType(parsed.typeName);
  if (memberType === null) {
    throw new Error(`could not resolve accessor type: ${symbol.demangled}`);
  }
  switch (parsed.kind) {
    case "getter":
      return { argTypes: [], returnType: memberType };
    case "setter":
      return { argTypes: [memberType], returnType: null };
    default:
      throw new Error(`cannot hook a 'modify' accessor (coroutine ABI): ${symbol.demangled}`);
  }
}

function returnsIndirectly(returnType: Metadata | null): boolean {
  return (
    returnType !== null &&
    returnType.valueWitnesses.size > 0 &&
    returnType.kind !== MetadataKind.Class &&
    floatClass(returnType) === null &&
    shouldPassIndirectly(returnType)
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

function materializeArgs(context: Arm64CpuContext, argTypes: Metadata[]): NativePointer[] {
  let ngrn = 0;
  let nsrn = 0;
  const out: NativePointer[] = [];

  for (const metadata of argTypes) {
    const cls = floatClass(metadata);
    if (cls !== null) {
      const scratch = Memory.alloc(8);
      const value = fpr(context, nsrn++, cls);
      cls === "double" ? scratch.writeDouble(value) : scratch.writeFloat(value);
      out.push(scratch);
    } else if (metadata.kind === MetadataKind.Class) {
      out.push(Memory.alloc(8).writePointer(gpr(context, ngrn++)));
    } else if (shouldPassIndirectly(metadata)) {
      out.push(gpr(context, ngrn++));
    } else {
      const count = words(metadata);
      const scratch = Memory.alloc(Math.max(count, 1) * 8);
      for (let w = 0; w < count; w++) {
        scratch.add(w * 8).writePointer(gpr(context, ngrn++));
      }
      out.push(scratch);
    }
  }
  return out;
}

function materializeReturn(
  context: Arm64CpuContext,
  returnType: Metadata | null,
  indirectReturn: NativePointer | null
): SwiftValue {
  if (returnType === null || returnType.valueWitnesses.size === 0) {
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

function attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener {
  const { argTypes, returnType } = callShape(target);
  const captureIndirect = returnsIndirectly(returnType);

  const onEnter =
    callbacks.onEnter !== undefined || captureIndirect
      ? function (this: InvocationContext) {
          const context = this.context as Arm64CpuContext;
          if (captureIndirect) {
            (this as unknown as { indirectReturn: NativePointer }).indirectReturn = context.x8;
          }
          if (callbacks.onEnter !== undefined) {
            const args = materializeArgs(context, argTypes);
            callbacks.onEnter.call(this, args.map((address, i) => readValue(argTypes[i], address)));
          }
        }
      : undefined;

  const onLeave =
    callbacks.onLeave !== undefined
      ? function (this: InvocationContext) {
          const indirect =
            (this as unknown as { indirectReturn?: NativePointer }).indirectReturn ?? null;
          callbacks.onLeave!.call(
            this,
            materializeReturn(this.context as Arm64CpuContext, returnType, indirect)
          );
        }
      : undefined;

  return Interceptor.attach(target, { onEnter, onLeave });
}

export interface SwiftInterceptorApi {
  attach(target: NativePointer, callbacks: SwiftInvocationCallbacks): InvocationListener;
}

export const SwiftInterceptor: SwiftInterceptorApi = { attach };
