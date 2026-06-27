function ensureDarwinArm64(): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    throw new Error("Only arm64 Darwin is currently supported");
  }
}

const LIBSWIFT_CORE_CANDIDATES = [
  "libswiftCore.dylib",
  "/usr/lib/swift/libswiftCore.dylib",
];

function loadLibswiftCore(): Module {
  const existing = Process.findModuleByName("libswiftCore.dylib");
  if (existing !== null) {
    return existing;
  }

  let lastError: Error | null = null;
  for (const candidate of LIBSWIFT_CORE_CANDIDATES) {
    try {
      return Module.load(candidate);
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new Error("libswiftCore.dylib not found");
}

export interface SwiftCoreApi {
  swift_demangle: NativeFunction<
    NativePointer,
    [NativePointerValue, number | UInt64, NativePointerValue, NativePointerValue, number]
  >;
  swift_getTypeByMangledNameInContext: NativeFunction<
    NativePointer,
    [NativePointerValue, number | UInt64, NativePointerValue, NativePointerValue]
  >;
  swift_conformsToProtocol: NativeFunction<
    NativePointer,
    [NativePointerValue, NativePointerValue]
  >;
  swift_projectBox: NativeFunction<NativePointer, [NativePointerValue]>;
  swift_getErrorValue: NativeFunction<
    void,
    [NativePointerValue, NativePointerValue, NativePointerValue]
  >;
  swift_getTypeName: NativeFunction<[NativePointer, UInt64], [NativePointerValue, number]>;
  swift_allocObject: NativeFunction<
    NativePointer,
    [NativePointerValue, number | UInt64, number | UInt64]
  >;
  swift_allocBox: NativeFunction<[NativePointer, NativePointer], [NativePointerValue]>;
  swift_retain: NativeFunction<NativePointer, [NativePointerValue]>;
  swift_release: NativeFunction<void, [NativePointerValue]>;
  swift_retainCount: NativeFunction<UInt64, [NativePointerValue]>;
  swift_deallocClassInstance: NativeFunction<
    void,
    [NativePointerValue, number | UInt64, number | UInt64]
  >;
  swift_isUniquelyReferenced_native: NativeFunction<number, [NativePointerValue]>;
  swift_getObjectType: NativeFunction<NativePointer, [NativePointerValue]>;
  swift_getExistentialTypeMetadata: NativeFunction<
    NativePointer,
    [number, NativePointerValue, number | UInt64, NativePointerValue]
  >;
}

let cachedSwiftCore: SwiftCoreApi | null = null;

export function getSwiftCoreApi(): SwiftCoreApi {
  ensureDarwinArm64();
  if (cachedSwiftCore !== null) {
    return cachedSwiftCore;
  }

  const lib = loadLibswiftCore();
  lib.ensureInitialized();

  cachedSwiftCore = {
    swift_demangle: new NativeFunction(lib.getExportByName("swift_demangle"), "pointer", [
      "pointer",
      "size_t",
      "pointer",
      "pointer",
      "int32",
    ]),
    swift_getTypeByMangledNameInContext: new NativeFunction(
      lib.getExportByName("swift_getTypeByMangledNameInContext"),
      "pointer",
      ["pointer", "size_t", "pointer", "pointer"]
    ),
    swift_conformsToProtocol: new NativeFunction(
      lib.getExportByName("swift_conformsToProtocol"),
      "pointer",
      ["pointer", "pointer"]
    ),
    swift_projectBox: new NativeFunction(
      lib.getExportByName("swift_projectBox"),
      "pointer",
      ["pointer"]
    ),
    swift_getErrorValue: new NativeFunction(
      lib.getExportByName("swift_getErrorValue"),
      "void",
      ["pointer", "pointer", "pointer"]
    ),
    swift_getTypeName: new NativeFunction(
      lib.getExportByName("swift_getTypeName"),
      ["pointer", "size_t"],
      ["pointer", "bool"]
    ),
    swift_allocObject: new NativeFunction(
      lib.getExportByName("swift_allocObject"),
      "pointer",
      ["pointer", "size_t", "size_t"]
    ),
    swift_allocBox: new NativeFunction(
      lib.getExportByName("swift_allocBox"),
      ["pointer", "pointer"],
      ["pointer"]
    ),
    swift_retain: new NativeFunction(lib.getExportByName("swift_retain"), "pointer", [
      "pointer",
    ]),
    swift_release: new NativeFunction(lib.getExportByName("swift_release"), "void", [
      "pointer",
    ]),
    swift_retainCount: new NativeFunction(
      lib.getExportByName("swift_retainCount"),
      "size_t",
      ["pointer"]
    ),
    swift_deallocClassInstance: new NativeFunction(
      lib.getExportByName("swift_deallocClassInstance"),
      "void",
      ["pointer", "size_t", "size_t"]
    ),
    swift_isUniquelyReferenced_native: new NativeFunction(
      lib.getExportByName("swift_isUniquelyReferenced_native"),
      "bool",
      ["pointer"]
    ),
    swift_getObjectType: new NativeFunction(
      lib.getExportByName("swift_getObjectType"),
      "pointer",
      ["pointer"]
    ),
    swift_getExistentialTypeMetadata: new NativeFunction(
      lib.getExportByName("swift_getExistentialTypeMetadata"),
      "pointer",
      ["uint8", "pointer", "size_t", "pointer"]
    ),
  };
  return cachedSwiftCore;
}

export interface MachOApi {
  getsectiondata: NativeFunction<
    NativePointer,
    [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue]
  >;
}

let cachedMachO: MachOApi | null = null;

export function getMachOApi(): MachOApi {
  ensureDarwinArm64();
  if (cachedMachO !== null) {
    return cachedMachO;
  }

  const lib = Process.getModuleByName("libmacho.dylib");
  lib.ensureInitialized();

  cachedMachO = {
    getsectiondata: new NativeFunction(lib.getExportByName("getsectiondata"), "pointer", [
      "pointer",
      "pointer",
      "pointer",
      "pointer",
    ]),
  };
  return cachedMachO;
}
