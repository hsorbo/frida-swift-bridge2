import { ContextDescriptor } from "./context-descriptor.js";
import {
  TypeReferenceKind,
  areImmediateMembersNegative,
  getResilientSuperclassRef,
  hasResilientSuperclass,
  metadataNegativeSizeInWords,
  metadataPositiveSizeInWords,
  numImmediateMembers,
  resilientSuperclassReferenceKind,
} from "./class-descriptor.js";
import { ClassMetadata, ROOT_CLASS_METADATA_SIZE } from "./class-metadata.js";
import { lookUpObjCClass } from "../runtime/objc.js";

export interface ClassMetadataBounds {
  negativeSizeInWords: number;
  positiveSizeInWords: number;
  immediateMembersOffset: number; // bytes, signed
}

// Port of MetadataReader.h's getClassMetadataBounds: pure memory reads up the ResilientSuperclass
// chain, never the runtime's private StoredClassMetadataBounds cache.
export function getClassMetadataBounds(descriptor: ContextDescriptor): ClassMetadataBounds {
  if (!hasResilientSuperclass(descriptor)) {
    const negativeSizeInWords = metadataNegativeSizeInWords(descriptor);
    const positiveSizeInWords = metadataPositiveSizeInWords(descriptor);
    const immediateMembersOffset = areImmediateMembersNegative(descriptor)
      ? -negativeSizeInWords * Process.pointerSize
      : (positiveSizeInWords - numImmediateMembers(descriptor)) * Process.pointerSize;
    return { negativeSizeInWords, positiveSizeInWords, immediateMembersOffset };
  }

  const bounds = boundsOfResilientSuperclass(descriptor);
  return adjustForSubclass(bounds, descriptor);
}

function boundsOfResilientSuperclass(descriptor: ContextDescriptor): ClassMetadataBounds {
  const ref = getResilientSuperclassRef(descriptor);
  if (ref === null) {
    return swiftRootClassBounds();
  }
  switch (resilientSuperclassReferenceKind(descriptor)) {
    case TypeReferenceKind.DirectTypeDescriptor:
      return getClassMetadataBounds(new ContextDescriptor(ref));
    case TypeReferenceKind.IndirectTypeDescriptor:
      return getClassMetadataBounds(new ContextDescriptor(ref.readPointer().strip()));
    case TypeReferenceKind.IndirectObjCClass:
      return boundsFromLiveClassMetadata(new ClassMetadata(ref.readPointer().strip()));
    case TypeReferenceKind.DirectObjCClassName: {
      const cls = lookUpObjCClass(ref.readUtf8String()!);
      if (cls === null) {
        throw new Error(`${descriptor.fullTypeName}: Objective-C superclass not found`);
      }
      return boundsFromLiveClassMetadata(new ClassMetadata(cls));
    }
  }
}

function boundsFromLiveClassMetadata(metadata: ClassMetadata): ClassMetadataBounds {
  if (metadata.isTypeMetadata) {
    return getClassMetadataBounds(metadata.description);
  }
  return swiftRootClassBounds();
}

// forSwiftRootClass()'s TargetHeapMetadataHeader (layoutString+destroy+ValueWitnesses) precedes
// every class metadata's address point, even a plain Objective-C one.
const ROOT_CLASS_NEGATIVE_SIZE_IN_WORDS = 3;

function swiftRootClassBounds(): ClassMetadataBounds {
  const positiveSizeInWords = ROOT_CLASS_METADATA_SIZE / Process.pointerSize;
  return {
    negativeSizeInWords: ROOT_CLASS_NEGATIVE_SIZE_IN_WORDS,
    positiveSizeInWords,
    immediateMembersOffset: positiveSizeInWords * Process.pointerSize,
  };
}

function adjustForSubclass(bounds: ClassMetadataBounds, descriptor: ContextDescriptor): ClassMetadataBounds {
  const numImmediate = numImmediateMembers(descriptor);
  if (areImmediateMembersNegative(descriptor)) {
    bounds.negativeSizeInWords += numImmediate;
    bounds.immediateMembersOffset = -bounds.negativeSizeInWords * Process.pointerSize;
  } else {
    bounds.immediateMembersOffset = bounds.positiveSizeInWords * Process.pointerSize;
    bounds.positiveSizeInWords += numImmediate;
  }
  return bounds;
}
