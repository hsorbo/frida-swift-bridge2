import { requireSwift } from "../swift.js";
import { FIXTURE_DYLIB, RESILIENT_DYLIB, FIXTURESYMS_DYLIB } from "./paths.js";

const EXT = Process.platform === "darwin" ? "dylib" : "so";
export const FIXTURE_MODULE = `fixture.${EXT}`;
export const RESILIENT_MODULE = `resilient.${EXT}`;
export const FIXTURESYMS_MODULE = `fixturesyms.${EXT}`;

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

// fixture.swift compiled under a second module name, left unstripped: same types
// as fixture but with the value-type init symbols retained in .symtab.
export function loadFixtureSyms(): Module {
  return loadModule(FIXTURESYMS_DYLIB, FIXTURESYMS_MODULE);
}
