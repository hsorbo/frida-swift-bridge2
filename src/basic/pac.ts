export const ARM64E_ABI = Process.platform === "darwin" && Process.arch === "arm64";

export function signCode(code: NativePointer): NativePointer {
  return ARM64E_ABI ? code.strip().sign("ia", ptr(0)) : code;
}
