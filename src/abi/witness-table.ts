import { BoundMethod, CallArg, CallResult, bindWitnessMethod, witnessGetProperty, witnessSetProperty } from "../runtime/method.js";

export class WitnessTable {
  constructor(readonly handle: NativePointer) {}

  get conformanceDescriptor(): NativePointer {
    return this.handle.readPointer();
  }

  requirement(witnessIndex: number): NativePointer {
    return this.handle.add(witnessIndex * Process.pointerSize).readPointer();
  }

  method(self: NativePointer, name: string): BoundMethod {
    return bindWitnessMethod(this, self, name);
  }

  get(self: NativePointer, name: string): CallResult {
    return witnessGetProperty(this, self, name);
  }

  set(self: NativePointer, name: string, value: CallArg): void {
    witnessSetProperty(this, self, name, value);
  }
}
