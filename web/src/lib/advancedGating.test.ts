import { describe, expect, it } from "vitest";
import { shouldShowAdvanced } from "./advancedGating";

describe("shouldShowAdvanced", () => {
  it("hides Advanced-only controls in Simple mode", () => {
    expect(shouldShowAdvanced(true)).toBe(false);
  });

  it("shows Advanced-only controls in Advanced mode", () => {
    expect(shouldShowAdvanced(false)).toBe(true);
  });
});
