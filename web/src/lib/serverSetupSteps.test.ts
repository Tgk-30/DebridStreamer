import { describe, expect, it } from "vitest";
import {
  SERVER_SETUP_STEPS,
  isFinalStep,
  nextStep,
  previousStep,
  stepIndex,
  stepProgress,
} from "./serverSetupSteps";

describe("serverSetupSteps", () => {
  it("walks forward to the terminal step then stops", () => {
    let step = SERVER_SETUP_STEPS[0];
    const visited = [step];
    for (let i = 0; i < 10; i += 1) {
      const next = nextStep(step);
      if (next == null) break;
      step = next;
      visited.push(step);
    }
    expect(visited).toEqual(["welcome", "keys", "access", "invite", "done"]);
    expect(nextStep("done")).toBeNull();
  });

  it("walks backward to the first step then stops", () => {
    expect(previousStep("invite")).toBe("access");
    expect(previousStep("welcome")).toBeNull();
  });

  it("back undoes next", () => {
    for (const step of SERVER_SETUP_STEPS) {
      const next = nextStep(step);
      if (next != null) expect(previousStep(next)).toBe(step);
    }
  });

  it("identifies the final step", () => {
    expect(isFinalStep("done")).toBe(true);
    expect(isFinalStep("welcome")).toBe(false);
  });

  it("reports monotonic, bounded progress", () => {
    expect(stepProgress("welcome")).toBe(0);
    expect(stepProgress("done")).toBe(1);
    let last = -1;
    for (const step of SERVER_SETUP_STEPS) {
      const p = stepProgress(step);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it("orders steps by their index", () => {
    expect(stepIndex("welcome")).toBe(0);
    expect(stepIndex("done")).toBe(SERVER_SETUP_STEPS.length - 1);
  });
});
