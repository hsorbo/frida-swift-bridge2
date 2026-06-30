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

// Closure synthesis works on arm64 (Darwin signs blraa, Linux uses a plain blr) and x86-64.
export function requireClosures(ctx: { skip: (reason?: string) => void }): void {
  if ((Process.arch !== "arm64" && Process.arch !== "x64") || !Swift.available) {
    ctx.skip("needs an arm64 or x86-64 Swift host");
  }
}

// arm64 always exposes v-registers; x86-64 surfaces xmm on the CpuContext only in Frida > 17.15.5.
export function requireFpRegisterHooks(ctx: { skip: (reason?: string) => never }): void {
  if (Process.arch !== "arm64" && Process.arch !== "x64") {
    ctx.skip(`FP register hooks need arm64 or x86-64, got ${Process.arch}`);
  }
  if (Process.arch === "x64" && !fridaVersionIsNewerThan(17, 15, 5)) {
    ctx.skip(`x86-64 xmm hooks need Frida > 17.15.5, got ${Frida.version}`);
  }
}

function fridaVersionIsNewerThan(major: number, minor: number, patch: number): boolean {
  const [a = 0, b = 0, c = 0] = Frida.version
    .split("-")[0]
    .split(".")
    .map(Number);
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c > patch;
}

export function requireSwiftHost(): void {
  const ok =
    (Process.arch === "arm64" || Process.arch === "x64") &&
    (Process.platform === "darwin" || Process.platform === "linux");
  if (!ok) {
    throw new Error(`needs arm64/x64 Darwin or Linux, got ${Process.arch}/${Process.platform}`);
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

// Onone-support sits beside libswiftCore; derive its dir from the loaded core, not a fixed path.
export function loadOnoneSupport(): Module {
  const existing = Process.findModuleByName(ONONE_SUPPORT_MODULE);
  if (existing !== null) {
    return existing;
  }
  const core = loadSwiftCore();
  const dir = core.path.slice(0, core.path.lastIndexOf("/"));
  Module.load(`${dir}/${ONONE_SUPPORT_MODULE}`);
  return Process.getModuleByName(ONONE_SUPPORT_MODULE);
}
