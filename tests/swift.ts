import { Swift } from "../src/index.js";

export function requireDarwinArm64(): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    throw new Error(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
}

export function requireSwift(): void {
  requireDarwinArm64();
  if (!Swift.available) {
    throw new Error("libswiftCore.dylib not loadable");
  }
}

export function loadSwiftCore(): Module {
  requireSwift();
  return Process.getModuleByName("libswiftCore.dylib");
}
