import { Swift } from "../src/index.js";

export type Skip = (reason?: string) => never;

export function requireDarwinArm64(skip: Skip): void {
  if (Process.arch !== "arm64" || Process.platform !== "darwin") {
    skip(`needs arm64 Darwin, got ${Process.arch}/${Process.platform}`);
  }
}

export function requireSwift(skip: Skip): void {
  requireDarwinArm64(skip);
  if (!Swift.available) {
    skip("libswiftCore.dylib not loadable");
  }
}

export function loadSwiftCore(skip: Skip): Module {
  requireSwift(skip);
  return Process.getModuleByName("libswiftCore.dylib");
}
