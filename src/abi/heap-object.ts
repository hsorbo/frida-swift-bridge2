import { Metadata } from "./metadata.js";
import { ClassMetadata, classMetadataOf, dynamicTypeOf } from "./class-metadata.js";
import { readVTableChain, VTableEntry } from "./class-descriptor.js";
import { enumerateClassInstanceFields, readObject, SwiftValue } from "./instance.js";
import { Value } from "./value.js";
import { getSwiftCoreApi } from "../runtime/api.js";
import {
  BoundMethod,
  GenericBoundMethod,
  ResolvedMethod,
  resolveMethod,
  bindGenericMethod,
  MethodResolveOptions,
  getProperty,
  setProperty,
  CallResult,
} from "../runtime/method.js";

// Also polyfilled in value.ts, but the method↔heap-object cycle can define this class first.
const symbolCtor = Symbol as { dispose?: symbol };
symbolCtor.dispose ??= Symbol.for("Symbol.dispose");

interface OwnedState {
  disposed: boolean;
}

interface VTableInvokeSignature {
  returnType: Metadata | null;
  argTypes: Metadata[];
  throws?: boolean;
}

export class HeapObject {
  private state: OwnedState | null = null;
  private weakId: WeakRefId | null = null;

  constructor(readonly handle: NativePointer) {}

  static adopt(handle: NativePointer): HeapObject {
    const object = new HeapObject(handle);
    const state: OwnedState = { disposed: false };
    object.state = state;
    const release = getSwiftCoreApi().swift_release;
    object.weakId = Script.bindWeak(object, () => {
      if (!state.disposed) {
        state.disposed = true;
        release(handle);
      }
    });
    return object;
  }

  get owned(): boolean {
    return this.state !== null;
  }

  get metadata(): ClassMetadata {
    return classMetadataOf(this.handle);
  }

  get dynamicType(): Metadata {
    return dynamicTypeOf(this.handle);
  }

  get retainCount(): number {
    return Number(getSwiftCoreApi().swift_retainCount(this.handle));
  }

  get isUniquelyReferenced(): boolean {
    return Boolean(getSwiftCoreApi().swift_isUniquelyReferenced_native(this.handle));
  }

  // On an owned object use dispose(), not release(): raw release plus GC release double-frees.
  retain(): this {
    getSwiftCoreApi().swift_retain(this.handle);
    return this;
  }

  release(): void {
    getSwiftCoreApi().swift_release(this.handle);
  }

  dispose(): void {
    if (this.state === null || this.state.disposed) {
      return;
    }
    this.state.disposed = true;
    if (this.weakId !== null) {
      Script.unbindWeak(this.weakId);
      this.weakId = null;
    }
    getSwiftCoreApi().swift_release(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  field(name: string): Value {
    for (const f of enumerateClassInstanceFields(this.handle)) {
      if (f.name === name) {
        if (f.type === null) {
          throw new Error(`HeapObject.field: unresolved type for field ${name}`);
        }
        return Value.borrow(f.type, f.address, this);
      }
    }
    throw new Error(`HeapObject.field: no field ${name}`);
  }

  read(): { [field: string]: SwiftValue } {
    return readObject(this.handle);
  }

  method(name: string, options: MethodResolveOptions = {}): BoundMethod | GenericBoundMethod {
    if (options.typeArguments !== undefined) {
      return bindGenericMethod(this.typeName, name, this.handle, { ...options, static: false });
    }
    return new BoundMethod(resolveMethod(this.typeName, name, { ...options, static: false }), this.handle);
  }

  get vtable(): VTableEntry[] {
    return readVTableChain(this.metadata);
  }

  vtableMethod(metadataOffset: number, signature: VTableInvokeSignature): BoundMethod {
    const entry = this.vtable.find((e) => e.metadataOffset === metadataOffset);
    if (entry === undefined) {
      throw new Error(`vtableMethod: no vtable slot at metadata offset ${metadataOffset}`);
    }
    const liveImpl = this.metadata.handle.add(metadataOffset * Process.pointerSize).readPointer();
    const resolved: ResolvedMethod = {
      address: liveImpl,
      argTypes: signature.argTypes,
      returnType: signature.returnType,
      throws: signature.throws ?? false,
      isStatic: !entry.isInstance,
      selector: `#${metadataOffset}`,
    };
    return new BoundMethod(resolved, this.handle);
  }

  call(name: string, ...args: SwiftValue[]): CallResult {
    return this.method(name).call(...args);
  }

  get(name: string): CallResult {
    return getProperty(this.handle, this.typeName, name);
  }

  set(name: string, value: SwiftValue): void {
    setProperty(this.handle, this.typeName, name, value);
  }

  private get typeName(): string {
    const name = this.metadata.description.fullTypeName;
    if (name === null) {
      throw new Error("HeapObject: class has no type name");
    }
    return name;
  }
}
