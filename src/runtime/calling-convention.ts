import { Metadata, MetadataKind } from "../abi/metadata.js";
import { enumerateFields, fieldTypeIn } from "../abi/field-descriptor.js";
import { typeName } from "./type-name.js";

export const MAX_LOADABLE_SIZE = Process.pointerSize * 4;

// Integer/pointer-class only; floating-point uses the separate v-register budget below.
export function shouldPassIndirectly(metadata: Metadata): boolean {
  const vwt = metadata.valueWitnesses;
  return !vwt.isBitwiseTakable || vwt.size > MAX_LOADABLE_SIZE;
}

export type FloatClass = "double" | "float";

export function floatClass(metadata: Metadata): FloatClass | null {
  switch (typeName(metadata)) {
    case "Swift.Double":
    case "Swift.Float64":
      return "double";
    case "Swift.Float":
    case "Swift.Float32":
      return "float";
    default:
      return null;
  }
}

export interface FloatLayout {
  cls: FloatClass;
  count: number;
}

// swiftcc passes each FP leaf in its own v-register; homogeneous and ≤4 (scalar = count 1).
export function floatLayout(metadata: Metadata): FloatLayout | null {
  const scalar = floatClass(metadata);
  if (scalar !== null) {
    return { cls: scalar, count: 1 };
  }
  if (metadata.kind !== MetadataKind.Struct) {
    return null;
  }
  let cls: FloatClass | null = null;
  let count = 0;
  for (const field of enumerateFields(metadata.description)) {
    const fieldType = fieldTypeIn(metadata, field);
    if (fieldType === null) {
      return null;
    }
    const leaf = floatLayout(fieldType);
    if (leaf === null || (cls !== null && leaf.cls !== cls)) {
      return null;
    }
    cls = leaf.cls;
    count += leaf.count;
    if (count > 4) {
      return null;
    }
  }
  return cls === null ? null : { cls, count };
}

// A generic-typed value is always passed indirectly.
export interface GenericRef {
  genericParam: number;
}

export type SwiftArgType = Metadata | GenericRef;

function isGenericRef(arg: SwiftArgType): arg is GenericRef {
  return !(arg instanceof Metadata);
}

interface LoweredArg {
  indirect: boolean;
  float: FloatLayout | null;
  words: number;
}

function lowerArg(arg: SwiftArgType): LoweredArg {
  if (isGenericRef(arg)) {
    return { indirect: true, float: null, words: 0 };
  }
  const float = floatLayout(arg);
  if (float !== null) {
    return { indirect: false, float, words: 0 };
  }
  if (shouldPassIndirectly(arg)) {
    return { indirect: true, float: null, words: 0 };
  }
  return { indirect: false, float: null, words: Math.ceil(arg.valueWitnesses.size / 8) };
}

export class SwiftThrownError extends Error {
  constructor(readonly error: NativePointer) {
    super(`Swift function threw (error at ${error})`);
    this.name = "SwiftThrownError";
  }
}

export interface SwiftNativeFunctionOptions {
  hasSelf?: boolean;
  throws?: boolean;
  typeArguments?: Metadata[];
  witnessTables?: NativePointer[];
}

export type SwiftNativeFunction = (...args: NativePointer[]) => NativePointer | null;

// args/result are pointers to value bytes (result freshly allocated; null for void). When
// hasSelf, the first argument is the self/context pointer (x20). Unhandled: float/SIMD aggregates.
export function makeSwiftNativeFunction(
  address: NativePointer,
  returnType: SwiftArgType | null,
  argTypes: SwiftArgType[],
  options: SwiftNativeFunctionOptions = {}
): SwiftNativeFunction {
  const hasSelf = options.hasSelf === true;
  const throws = options.throws === true;
  const typeArguments = options.typeArguments ?? [];
  const witnessTables = options.witnessTables ?? [];
  const typeArgumentFor = (ref: GenericRef): Metadata => {
    const metadata = typeArguments[ref.genericParam];
    if (metadata === undefined) {
      throw new Error(`no type argument for generic parameter ${ref.genericParam}`);
    }
    return metadata;
  };

  const loweredArgs = argTypes.map(lowerArg);
  const fridaArgTypes: NativeFunctionArgumentType[] = [];
  for (const arg of loweredArgs) {
    if (arg.indirect) {
      fridaArgTypes.push("pointer");
    } else if (arg.float !== null) {
      for (let i = 0; i < arg.float.count; i++) {
        fridaArgTypes.push(arg.float.cls);
      }
    } else {
      for (let i = 0; i < arg.words; i++) {
        fridaArgTypes.push("uint64");
      }
    }
  }
  // trailing implicit args after the formal ones: a type-metadata pointer per param, then witnesses
  for (let i = 0; i < typeArguments.length + witnessTables.length; i++) {
    fridaArgTypes.push("pointer");
  }

  let indirectResult = false;
  let directWords = 0;
  let floatResult: FloatLayout | null = null;
  let resultSize = 0;
  let resultStride = 0;
  if (returnType !== null) {
    const genericReturn = isGenericRef(returnType);
    const returnMetadata = genericReturn ? typeArgumentFor(returnType) : returnType;
    resultSize = returnMetadata.valueWitnesses.size;
    resultStride = returnMetadata.valueWitnesses.stride;
    if (resultSize > 0) {
      if (genericReturn) {
        indirectResult = true; // generic return: indirect regardless of size
      } else {
        floatResult = floatLayout(returnMetadata);
        if (floatResult !== null) {
          // captured from v0..v(count-1)
        } else if (shouldPassIndirectly(returnMetadata)) {
          indirectResult = true;
        } else {
          directWords = Math.ceil(resultSize / 8);
        }
      }
    }
  }

  // The returned closure captures `resources`, keeping the trampoline's baked buffers alive
  // (Frida frees a Memory.alloc when its NativePointer is collected). self/error/scratch are
  // single shared buffers per function, so the trampoline is not re-entrant.
  const savesContext = hasSelf || throws;
  const code = Memory.alloc(Process.pageSize);
  const save = Memory.alloc(Process.pointerSize * (savesContext ? 4 : 2));
  const scratch = resultSize > 0 ? Memory.alloc(Math.max(resultStride, 8)) : ptr(0);
  const selfBuffer = hasSelf ? Memory.alloc(Process.pointerSize) : null;
  const errorBuffer = throws ? Memory.alloc(Process.pointerSize) : null;
  writeTrampoline(code, {
    save,
    target: address,
    selfBuffer,
    errorBuffer,
    indirectResultBuffer: indirectResult ? scratch : null,
    directWords,
    directResultBuffer: directWords > 0 ? scratch : null,
    floatResult: floatResult !== null ? { ...floatResult, buffer: scratch } : null,
  });
  const resources = {
    code,
    save,
    scratch,
    selfBuffer,
    errorBuffer,
    invoke: new NativeFunction(code, "void", fridaArgTypes) as unknown as (
      ...args: NativeFunctionArgumentValue[]
    ) => void,
  };

  return (...args: NativePointer[]): NativePointer | null => {
    const expected = argTypes.length + (hasSelf ? 1 : 0);
    if (args.length !== expected) {
      throw new Error(`expected ${expected} argument(s), got ${args.length}`);
    }

    let next = 0;
    if (hasSelf) {
      resources.selfBuffer!.writePointer(args[next++]);
    }

    const physical: NativeFunctionArgumentValue[] = [];
    for (let i = 0; i < loweredArgs.length; i++) {
      const lowered = loweredArgs[i];
      const value = args[next++];
      if (lowered.indirect) {
        physical.push(value);
      } else if (lowered.float !== null) {
        const stride = lowered.float.cls === "double" ? 8 : 4;
        for (let k = 0; k < lowered.float.count; k++) {
          const leaf = value.add(k * stride);
          physical.push(lowered.float.cls === "double" ? leaf.readDouble() : leaf.readFloat());
        }
      } else {
        for (let w = 0; w < lowered.words; w++) {
          physical.push(value.add(w * 8).readU64());
        }
      }
    }
    for (const metadata of typeArguments) {
      physical.push(metadata.handle);
    }
    for (const witnessTable of witnessTables) {
      physical.push(witnessTable);
    }

    resources.invoke(...physical);

    if (throws) {
      const error = resources.errorBuffer!.readPointer();
      if (!error.isNull()) {
        throw new SwiftThrownError(error);
      }
    }

    if (resultSize === 0) {
      return null;
    }
    const out = Memory.alloc(resultStride);
    Memory.copy(out, resources.scratch, resultSize);
    return out;
  };
}

interface TrampolineConfig {
  save: NativePointer;
  target: NativePointer;
  selfBuffer: NativePointer | null;
  errorBuffer: NativePointer | null;
  indirectResultBuffer: NativePointer | null;
  directWords: number;
  directResultBuffer: NativePointer | null;
  floatResult: (FloatLayout & { buffer: NativePointer }) | null;
}

function writeTrampoline(code: NativePointer, cfg: TrampolineConfig): void {
  const savesContext = cfg.selfBuffer !== null || cfg.errorBuffer !== null;

  Memory.patchCode(code, 0x100, (slot) => {
    const writer = new Arm64Writer(slot, { pc: code });

    writer.putLdrRegAddress("x15", cfg.save);
    writer.putStpRegRegRegOffset("x29", "x30", "x15", 0, "post-adjust");
    if (savesContext) {
      writer.putStpRegRegRegOffset("x20", "x21", "x15", 16, "signed-offset");
    }

    if (cfg.selfBuffer !== null) {
      writer.putLdrRegAddress("x15", cfg.selfBuffer);
      writer.putLdrRegRegOffset("x20", "x15", 0);
    }
    if (cfg.errorBuffer !== null) {
      writer.putMovRegReg("x21", "xzr");
    }
    if (cfg.indirectResultBuffer !== null) {
      writer.putLdrRegAddress("x8", cfg.indirectResultBuffer);
    }

    writer.putLdrRegAddress("x14", cfg.target);
    writer.putBlrRegNoAuth("x14");

    if (cfg.directResultBuffer !== null) {
      writer.putLdrRegAddress("x15", cfg.directResultBuffer);
      for (let i = 0; i < cfg.directWords; i++) {
        writer.putStrRegRegOffset(`x${i}` as Arm64Register, "x15", i * 8);
      }
    }
    if (cfg.floatResult !== null) {
      writer.putLdrRegAddress("x15", cfg.floatResult.buffer);
      const prefix = cfg.floatResult.cls === "double" ? "d" : "s";
      const stride = cfg.floatResult.cls === "double" ? 8 : 4;
      for (let i = 0; i < cfg.floatResult.count; i++) {
        writer.putStrRegRegOffset(`${prefix}${i}` as Arm64Register, "x15", i * stride);
      }
    }
    if (cfg.errorBuffer !== null) {
      writer.putLdrRegAddress("x15", cfg.errorBuffer);
      writer.putStrRegRegOffset("x21", "x15", 0);
    }

    writer.putLdrRegAddress("x15", cfg.save);
    writer.putLdpRegRegRegOffset("x29", "x30", "x15", 0, "post-adjust");
    if (savesContext) {
      writer.putLdpRegRegRegOffset("x20", "x21", "x15", 16, "signed-offset");
    }
    writer.putRet();

    writer.flush();
  });
}
