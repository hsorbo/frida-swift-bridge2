export class WitnessTable {
  constructor(readonly handle: NativePointer) {}

  get conformanceDescriptor(): NativePointer {
    return this.handle.readPointer();
  }

  requirement(witnessIndex: number): NativePointer {
    return this.handle.add(witnessIndex * Process.pointerSize).readPointer();
  }
}
