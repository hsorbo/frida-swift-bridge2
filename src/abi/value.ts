import { Metadata, MetadataKind } from "./metadata.js";
import { readValue, writeValue, enumerateInstanceFields, SwiftValue } from "./instance.js";
import { decodeBridgedContainer } from "./container.js";
import {
  BoundValueMethod,
  GenericBoundMethod,
  bindValueMethod,
  bindGenericValueMethod,
  bindGenericTypeValueMethod,
  ValueMethodResolveOptions,
  CallResult,
  CallArg,
} from "../runtime/method.js";
import { SwiftType, typeOf } from "../runtime/swift-type.js";

// qjs and v8 (Frida 17) ship no Symbol.dispose; polyfill so `using` resolves the key below.
const symbolCtor = Symbol as { dispose?: symbol };
symbolCtor.dispose ??= Symbol.for("Symbol.dispose");

interface OwnedState {
  disposed: boolean;
}

export class ValueInstance {
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

  static borrow(metadata: Metadata, address: NativePointer, keepAlive: unknown = null): ValueInstance {
    return new ValueInstance(metadata, address, null, keepAlive);
  }

  static fromJS(metadata: Metadata, value: SwiftValue): ValueInstance {
    const storage = Memory.alloc(metadata.typeLayout.stride);
    writeValue(metadata, storage, value);
    return new ValueInstance(metadata, storage, { disposed: false }, null);
  }

  static fromCopy(metadata: Metadata, src: NativePointer): ValueInstance {
    const storage = Memory.alloc(metadata.typeLayout.stride);
    metadata.valueWitnesses.initializeWithCopy(storage, src);
    return new ValueInstance(metadata, storage, { disposed: false }, null);
  }

  static adopt(metadata: Metadata, address: NativePointer): ValueInstance {
    return new ValueInstance(metadata, address, { disposed: false }, null);
  }

  get owned(): boolean {
    return this.state !== null;
  }

  get $type(): SwiftType {
    return typeOf(this.metadata);
  }

  get(): SwiftValue {
    this.checkLive();
    return readValue(this.metadata, this.address);
  }

  set(value: SwiftValue): void {
    this.checkLive();
    writeValue(this.metadata, this.address, value);
  }

  container(): SwiftValue {
    this.checkLive();
    const decoded = decodeBridgedContainer(this.metadata, this.address);
    if (decoded === null) {
      throw new Error("ValueInstance is not a bridged Array/Set/Dictionary");
    }
    return decoded.value;
  }

  field(name: string): ValueInstance {
    this.checkLive();
    if (this.metadata.kind !== MetadataKind.Struct) {
      throw new Error("ValueInstance.field is supported on struct values only");
    }
    for (const f of enumerateInstanceFields(this.metadata, this.address)) {
      if (f.name === name) {
        if (f.type === null) {
          throw new Error(`ValueInstance.field: unresolved type for field ${name}`);
        }
        return ValueInstance.borrow(f.type, f.address, this);
      }
    }
    throw new Error(`ValueInstance.field: no field ${name}`);
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

  call(name: string, ...args: CallArg[]): CallResult {
    return this.method(name).call(...args);
  }

  copy(): ValueInstance {
    this.checkLive();
    return ValueInstance.fromCopy(this.metadata, this.address);
  }

  // Init uninitialized dest with a +1 copy; lets an opaque value cross a call boundary the JS writers can't.
  copyInto(dest: NativePointer): void {
    this.checkLive();
    this.metadata.valueWitnesses.initializeWithCopy(dest, this.address);
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
      throw new Error("ValueInstance has been disposed");
    }
  }
}
