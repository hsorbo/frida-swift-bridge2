import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, AsyncContext } from "../src/index.js";

const COMPUTE_ASYNC = "$s7fixture12computeAsyncyS2iYaF";
const DRIVE = "$s7fixture17driveComputeAsyncyS2iF";

function within(module: Module, p: NativePointer): boolean {
  return p.compare(module.base) >= 0 && p.compare(module.base.add(module.size)) < 0;
}

describe("async context", () => {
  test("decodes parent and resume-parent from a live async context", () => {
    requireSwift();
    const module = loadFixture();
    const drive = new NativeFunction(module.getExportByName(DRIVE), "long", ["long"]);

    let hasParent: boolean | undefined;
    let resumeInModule: boolean | undefined;
    let parentResumeReadable: boolean | undefined;
    let ancestorCount: number | undefined;

    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onEnter(_args, context) {
        const ctx = new AsyncContext(context);
        const parent = ctx.parent;
        hasParent = parent !== null;
        resumeInModule = within(module, ctx.resumeParent);
        parentResumeReadable = parent !== null && !parent.resumeParent.isNull();
        let n = 0;
        for (const _ of ctx.ancestors()) {
          if (++n >= 64) break;
        }
        ancestorCount = n;
      },
    });
    try {
      expect(Number(drive(7))).toBe(14);
      expect(hasParent).toBe(true);
      expect(resumeInModule).toBe(true);
      expect(parentResumeReadable).toBe(true);
      expect(ancestorCount).toBeGreaterThanOrEqual(1);
      expect(ancestorCount).toBeLessThan(64); // walked to the root, not a runaway chain
    } finally {
      listener.detach();
    }
  });
});
