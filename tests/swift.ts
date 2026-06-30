import { Swift } from "../src/index.js";

const LIBSWIFT_CORE_NAME =
  Process.platform === "darwin" ? "libswiftCore.dylib" : "libswiftCore.so";

export const SWIFTCORE_MODULE = LIBSWIFT_CORE_NAME;
export const NON_SWIFT_MODULE =
  Process.platform === "darwin" ? "libsystem_kernel.dylib" : "libc.so.6";

export const ONONE_SUPPORT_MODULE =
  Process.platform === "darwin"
    ? "libswiftSwiftOnoneSupport.dylib"
    : "libswiftSwiftOnoneSupport.so";
export const ONONE_SUPPORT_PATH =
  Process.platform === "darwin"
    ? "/usr/lib/swift/libswiftSwiftOnoneSupport.dylib"
    : "/usr/lib/swift/linux/libswiftSwiftOnoneSupport.so";

export function requireDarwin(ctx: { skip: (reason?: string) => never }): void {
  if (Process.platform !== "darwin") {
    ctx.skip("Darwin-only");
  }
}

export function requireLinux(ctx: { skip: (reason?: string) => never }): void {
  if (Process.platform !== "linux") {
    ctx.skip("Linux-only");
  }
}

export function requireSwiftHost(): void {
  const ok =
    Process.arch === "arm64" &&
    (Process.platform === "darwin" || Process.platform === "linux");
  if (!ok) {
    throw new Error(`needs arm64 Darwin or Linux, got ${Process.arch}/${Process.platform}`);
  }
}

export function requireSwift(): void {
  requireSwiftHost();
  if (!Swift.available) {
    throw new Error(`${LIBSWIFT_CORE_NAME} not loadable`);
  }
}

export function loadSwiftCore(): Module {
  requireSwift();
  return Process.getModuleByName(LIBSWIFT_CORE_NAME);
}
