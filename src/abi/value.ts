import { Metadata, MetadataKind } from "./metadata.js";
import { readValue, writeValue, enumerateInstanceFields, SwiftValue } from "./instance.js";
import {
  BoundValueMethod,
  GenericBoundMethod,
  bindValueMethod,
  bindGenericValueMethod,
  bindGenericTypeValueMethod,
  ValueMethodResolveOptions,
  CallResult,
} from "../runtime/method.js";

// qjs and v8 (Frida 17) ship no Symbol.dispose; polyfill so `using` resolves the key below.
const symbolCtor = Symbol as { dispose?: symbol };
symbolCtor.dispose ??= Symbol.for("Symbol.dispose");

interface OwnedState {
  disposed: boolean;
}

export class Value {
  private weakId: WeakRefId | null = null;

  private constructor(
    readonly metadata: Metadata,
    readonly address: NativePointer,
    private readonly state: OwnedState | null,
    private readonly keepAlive: unknown
  ) {
    if (state !== null) {
      const vwt = metadata.valueWitnesses;
      const addr = address;
      this.weakId = Script.bindWeak(this, () => {
        if (!state.disposed) {
          state.disposed = true;
          vwt.destroy(addr);
        }
      });
    }
  }

  static borrow(metadata: Metadata, address: NativePointer, keepAlive: unknown = null): Value {
    return new Value(metadata, address, null, keepAlive);
  }

  static fromJS(metadata: Metadata, value: SwiftValue): Value {
    const storage = Memory.alloc(metadata.typeLayout.stride);
    writeValue(metadata, storage, value);
    return new Value(metadata, storage, { disposed: false }, null);
  }

  static fromCopy(metadata: Metadata, src: NativePointer): Value {
    const storage = Memory.alloc(metadata.typeLayout.stride);
    metadata.valueWitnesses.initializeWithCopy(storage, src);
    return new Value(metadata, storage, { disposed: false }, null);
  }

  static adopt(metadata: Metadata, address: NativePointer): Value {
    return new Value(metadata, address, { disposed: false }, null);
  }

  get owned(): boolean {
    return this.state !== null;
  }

  get(): SwiftValue {
    this.checkLive();
    return readValue(this.metadata, this.address);
  }

  set(value: SwiftValue): void {
    this.checkLive();
    writeValue(this.metadata, this.address, value);
  }

  field(name: string): Value {
    this.checkLive();
    if (this.metadata.kind !== MetadataKind.Struct) {
      throw new Error("Value.field is supported on struct values only");
    }
    for (const f of enumerateInstanceFields(this.metadata, this.address)) {
      if (f.name === name) {
        if (f.type === null) {
          throw new Error(`Value.field: unresolved type for field ${name}`);
        }
        return Value.borrow(f.type, f.address, this);
      }
    }
    throw new Error(`Value.field: no field ${name}`);
  }

  method(name: string, options: ValueMethodResolveOptions = {}): BoundValueMethod | GenericBoundMethod {
    this.checkLive();
    if (options.typeArguments !== undefined) {
      return bindGenericValueMethod(this.metadata, this.address, name, options);
    }
    if (this.metadata.description.isGeneric) {
      return bindGenericTypeValueMethod(this.metadata, this.address, name, options);
    }
    return bindValueMethod(this.metadata, this.address, name, options);
  }

  call(name: string, ...args: SwiftValue[]): CallResult {
    return this.method(name).call(...args);
  }

  copy(): Value {
    this.checkLive();
    return Value.fromCopy(this.metadata, this.address);
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
    this.metadata.valueWitnesses.destroy(this.address);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  private checkLive(): void {
    if (this.state !== null && this.state.disposed) {
      throw new Error("Value has been disposed");
    }
  }
}
