import { requireSwift } from "../swift.js";
import { FIXTURE_DYLIB, RESILIENT_DYLIB } from "./paths.js";

export const FIXTURE_MODULE = "fixture.dylib";
export const RESILIENT_MODULE = "resilient.dylib";

function loadModule(path: string, name: string): Module {
  requireSwift();
  const existing = Process.findModuleByName(name);
  if (existing !== null) {
    return existing;
  }
  Module.load(path);
  return Process.getModuleByName(name);
}

export function loadFixture(): Module {
  return loadModule(FIXTURE_DYLIB, FIXTURE_MODULE);
}

export function loadResilient(): Module {
  return loadModule(RESILIENT_DYLIB, RESILIENT_MODULE);
}
