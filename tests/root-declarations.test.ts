import { test, expect, describe } from "@frida/injest/agent";

import {
  AnyClosureBody,
  InvertedProtocolsRequirement,
  SelfRouting,
  GenericMethodPlan,
} from "../src/index.js";

describe("root companion type exports", () => {
  test("types named by public declarations are importable from the root", () => {
    const body: AnyClosureBody = (...args) => args.length;
    const routing: SelfRouting = { indirect: true };
    const plan: GenericMethodPlan | null = null;
    const inverted: InvertedProtocolsRequirement | null = null;
    expect(typeof body).toBe("function");
    expect(routing.indirect).toBe(true);
    expect(plan).toBe(null);
    expect(inverted).toBe(null);
  });
});
