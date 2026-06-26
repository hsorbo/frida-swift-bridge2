import { Metadata } from "../abi/metadata.js";

export const MAX_LOADABLE_SIZE = Process.pointerSize * 4;

// Integer/pointer-class only; float/SIMD use a separate v-register budget (not handled).
export function shouldPassIndirectly(metadata: Metadata): boolean {
  const vwt = metadata.valueWitnesses;
  return !vwt.isBitwiseTakable || vwt.size > MAX_LOADABLE_SIZE;
}

interface LoweredArg {
  indirect: boolean;
  words: number;
}

function lowerArg(metadata: Metadata): LoweredArg {
  if (shouldPassIndirectly(metadata)) {
    return { indirect: true, words: 0 };
  }
  return { indirect: false, words: Math.ceil(metadata.valueWitnesses.size / 8) };
}

export type SwiftNativeFunction = (...args: NativePointer[]) => NativePointer | null;

// args/result are pointers to value bytes (result freshly allocated; null for void).
// Unhandled: self (x20), throws (x21), float/SIMD. Owned args pass by reference (callee may consume).
export function makeSwiftNativeFunction(
  address: NativePointer,
  returnType: Metadata | null,
  argTypes: Metadata[]
): SwiftNativeFunction {
  const loweredArgs = argTypes.map(lowerArg);
  const fridaArgTypes: NativeFunctionArgumentType[] = [];
  for (const arg of loweredArgs) {
    if (arg.indirect) {
      fridaArgTypes.push("pointer");
    } else {
      for (let i = 0; i < arg.words; i++) {
        fridaArgTypes.push("uint64");
      }
    }
  }

  let indirectResult = false;
  let directWords = 0;
  let resultSize = 0;
  let resultStride = 0;
  if (returnType !== null) {
    resultSize = returnType.valueWitnesses.size;
    resultStride = returnType.valueWitnesses.stride;
    if (resultSize > 0) {
      if (shouldPassIndirectly(returnType)) {
        indirectResult = true;
      } else {
        directWords = Math.ceil(resultSize / 8);
      }
    }
  }

  // The returned closure captures `resources`, keeping the trampoline's baked buffers alive
  // (Frida frees a Memory.alloc when its NativePointer is collected); shared save/scratch aren't re-entrant.
  const code = Memory.alloc(Process.pageSize);
  const save = Memory.alloc(Process.pointerSize * 2);
  const scratch = resultSize > 0 ? Memory.alloc(Math.max(resultStride, 8)) : ptr(0);
  writeTrampoline(
    code,
    save,
    address,
    indirectResult ? scratch : null,
    directWords,
    directWords > 0 ? scratch : null
  );
  const resources = {
    code,
    save,
    scratch,
    invoke: new NativeFunction(code, "void", fridaArgTypes) as unknown as (
      ...args: NativeFunctionArgumentValue[]
    ) => void,
  };

  return (...args: NativePointer[]): NativePointer | null => {
    if (args.length !== argTypes.length) {
      throw new Error(`expected ${argTypes.length} argument(s), got ${args.length}`);
    }

    const physical: NativeFunctionArgumentValue[] = [];
    for (let i = 0; i < args.length; i++) {
      const lowered = loweredArgs[i];
      const value = args[i];
      if (lowered.indirect) {
        physical.push(value);
      } else {
        for (let w = 0; w < lowered.words; w++) {
          physical.push(value.add(w * 8).readU64());
        }
      }
    }

    resources.invoke(...physical);

    if (resultSize === 0) {
      return null;
    }
    const out = Memory.alloc(resultStride);
    Memory.copy(out, resources.scratch, resultSize);
    return out;
  };
}

function writeTrampoline(
  code: NativePointer,
  save: NativePointer,
  target: NativePointer,
  indirectResultBuffer: NativePointer | null,
  directWords: number,
  directResultBuffer: NativePointer | null
): void {
  Memory.patchCode(code, 0x100, (slot) => {
    const writer = new Arm64Writer(slot, { pc: code });

    writer.putLdrRegAddress("x15", save);
    writer.putStpRegRegRegOffset("x29", "x30", "x15", 0, "post-adjust");

    if (indirectResultBuffer !== null) {
      writer.putLdrRegAddress("x8", indirectResultBuffer);
    }

    writer.putLdrRegAddress("x14", target);
    writer.putBlrRegNoAuth("x14");

    if (directResultBuffer !== null) {
      writer.putLdrRegAddress("x15", directResultBuffer);
      for (let i = 0; i < directWords; i++) {
        writer.putStrRegRegOffset(`x${i}` as Arm64Register, "x15", i * 8);
      }
    }

    writer.putLdrRegAddress("x15", save);
    writer.putLdpRegRegRegOffset("x29", "x30", "x15", 0, "post-adjust");
    writer.putRet();

    writer.flush();
  });
}
