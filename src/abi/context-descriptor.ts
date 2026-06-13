import {
  RelativeDirectPointer,
  RelativeIndirectablePointer,
} from "../basic/relative-pointer.js";

export enum ContextDescriptorKind {
  Module = 0,
  Extension = 1,
  Anonymous = 2,
  Protocol = 3,
  OpaqueType = 4,
  Class = 16,
  Struct = 17,
  Enum = 18,
}

const OFFSETOF_FLAGS = 0x0;
const OFFSETOF_PARENT = 0x4;
const OFFSETOF_NAME = 0x8;
const OFFSETOF_ACCESS_FUNCTION = 0xc;

const KIND_MASK = 0x1f;
const FLAG_IS_GENERIC = 0x80;

export class ContextDescriptor {
  constructor(readonly handle: NativePointer) {}

  get flags(): number {
    return this.handle.add(OFFSETOF_FLAGS).readU32();
  }

  get kind(): ContextDescriptorKind {
    return this.flags & KIND_MASK;
  }

  get isGeneric(): boolean {
    return (this.flags & FLAG_IS_GENERIC) !== 0;
  }

  get isType(): boolean {
    const kind = this.kind;
    return (
      kind === ContextDescriptorKind.Class ||
      kind === ContextDescriptorKind.Struct ||
      kind === ContextDescriptorKind.Enum
    );
  }

  get parent(): ContextDescriptor | null {
    const ptr = RelativeIndirectablePointer.resolve(
      this.handle.add(OFFSETOF_PARENT)
    );
    return ptr === null ? null : new ContextDescriptor(ptr);
  }

  get name(): string | null {
    const ptr = RelativeDirectPointer.resolve(this.handle.add(OFFSETOF_NAME));
    return ptr === null ? null : ptr.readUtf8String();
  }

  get accessFunction(): NativePointer | null {
    return RelativeDirectPointer.resolve(
      this.handle.add(OFFSETOF_ACCESS_FUNCTION)
    );
  }

  get moduleName(): string | null {
    let ctx: ContextDescriptor | null = this;
    while (ctx !== null && ctx.kind !== ContextDescriptorKind.Module) {
      ctx = ctx.parent;
    }
    return ctx === null ? null : ctx.name;
  }

  get fullTypeName(): string | null {
    const name = this.name;
    if (name === null) {
      return null;
    }
    const module = this.moduleName;
    return module === null ? name : `${module}.${name}`;
  }
}
