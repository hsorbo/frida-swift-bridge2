import { Metadata } from "./metadata.js";
import { ClassMetadata, classMetadataOf, dynamicTypeOf } from "./class-metadata.js";
import { enumerateClassInstanceFields, readObject, SwiftValue } from "./instance.js";
import { Value } from "./value.js";
import { getSwiftCoreApi } from "../runtime/api.js";

export class HeapObject {
  constructor(readonly handle: NativePointer) {}

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

  retain(): this {
    getSwiftCoreApi().swift_retain(this.handle);
    return this;
  }

  release(): void {
    getSwiftCoreApi().swift_release(this.handle);
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
}
