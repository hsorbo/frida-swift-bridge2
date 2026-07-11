const OFFSETOF_PARENT = 0x0;
const OFFSETOF_RESUME_PARENT = Process.pointerSize;

export class AsyncContext {
  constructor(readonly handle: NativePointer) {}

  get parent(): AsyncContext | null {
    const p = this.handle.add(OFFSETOF_PARENT).readPointer().strip();
    return p.isNull() ? null : new AsyncContext(p);
  }

  get resumeParent(): NativePointer {
    return this.handle.add(OFFSETOF_RESUME_PARENT).readPointer().strip();
  }

  *ancestors(): Generator<AsyncContext> {
    let ctx = this.parent;
    while (ctx !== null) {
      yield ctx;
      ctx = ctx.parent;
    }
  }
}
