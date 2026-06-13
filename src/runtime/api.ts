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
