import { requireSwift, type Skip } from "../swift.js";
import { FIXTURE_DYLIB, RESILIENT_DYLIB } from "./paths.js";

export const FIXTURE_MODULE = "fixture.dylib";
export const RESILIENT_MODULE = "resilient.dylib";

function loadModule(skip: Skip, path: string, name: string): Module {
  requireSwift(skip);
  const existing = Process.findModuleByName(name);
  if (existing !== null) {
    return existing;
  }
  if (path === "") {
    skip(`${name} was not built (no Swift toolchain?)`);
  }
  try {
    Module.load(path);
  } catch (e) {
    skip(`could not load ${name}: ${e}`);
  }
  return Process.getModuleByName(name);
}

export function loadFixture(skip: Skip): Module {
  return loadModule(skip, FIXTURE_DYLIB, FIXTURE_MODULE);
}

export function loadResilient(skip: Skip): Module {
  return loadModule(skip, RESILIENT_DYLIB, RESILIENT_MODULE);
}
