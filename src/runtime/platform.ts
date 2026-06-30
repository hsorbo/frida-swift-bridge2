export const SWIFT_HOST_SUPPORTED =
  Process.arch === "arm64" && (Process.platform === "darwin" || Process.platform === "linux");

export const LIBSWIFT_CORE_NAME =
  Process.platform === "darwin" ? "libswiftCore.dylib" : "libswiftCore.so";

export function ensureSwiftHost(): void {
  if (!SWIFT_HOST_SUPPORTED) {
    throw new Error(`unsupported Swift host: ${Process.arch}/${Process.platform}`);
  }
}
