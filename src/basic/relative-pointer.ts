/* TODO: handle PAC pointers. */

export class RelativeDirectPointer {
  static readonly sizeOf = 4;

  static resolve(at: NativePointer): NativePointer | null {
    const offset = at.readS32();
    return offset === 0 ? null : at.add(offset);
  }
}

export class RelativeIndirectablePointer {
  static resolve(at: NativePointer): NativePointer | null {
    const offset = at.readS32();
    if (offset === 0) {
      return null;
    }
    const address = at.add(offset & ~1);
    return (offset & 1) !== 0 ? address.readPointer() : address;
  }
}
