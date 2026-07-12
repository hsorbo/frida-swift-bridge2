import { test, expect, describe } from "@frida/injest/agent";
import { requireSwift } from "./swift.js";
import { loadFixture } from "./fixtures/load.js";

import { Swift, currentAsyncTask, JobKind, JobPriority } from "../src/index.js";

const COMPUTE_ASYNC = "$s7fixture12computeAsyncyS2iYaF";
const DRIVE = "$s7fixture17driveComputeAsyncyS2iF";

describe("async task", () => {
  test("introspects the live running task from inside an async function", () => {
    requireSwift();
    const module = loadFixture();
    const drive = new NativeFunction(module.getExportByName(DRIVE), "long", ["long"]);

    let isTask: boolean | undefined;
    let kind: JobKind | undefined;
    let id: number | undefined;
    let priorityKnown: boolean | undefined;
    let hasResumeFunction: boolean | undefined;
    let resumeContextReadable: boolean | undefined;

    const listener = Swift.Interceptor.attachAsync(module.getExportByName(COMPUTE_ASYNC), {
      onEnter() {
        const task = currentAsyncTask();
        if (task === null) {
          return;
        }
        isTask = task.isAsyncTask;
        kind = task.kind;
        id = task.id;
        priorityKnown = task.priority in JobPriority;
        hasResumeFunction = !task.resumeFunction.isNull();
        const ctx = task.resumeContext;
        resumeContextReadable = ctx !== null && !ctx.resumeParent.isNull();
      },
    });
    try {
      expect(Number(drive(7))).toBe(14);
      expect(isTask).toBe(true);
      expect(kind).toBe(JobKind.Task);
      expect(id).toBeGreaterThan(0);
      expect(priorityKnown).toBe(true);
      expect(hasResumeFunction).toBe(true);
      expect(resumeContextReadable).toBe(true);
    } finally {
      listener.detach();
    }
  });
});
