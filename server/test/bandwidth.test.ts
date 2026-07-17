import { describe, expect, it } from "vitest";
import { bandwidthCapStatus } from "../src/bandwidth.js";

describe("bandwidthCapStatus", () => {
  it("is ok below 80%, approaching from 80%, and over from 100%", () => {
    expect(bandwidthCapStatus(79, 100)).toBe("ok");
    expect(bandwidthCapStatus(80, 100)).toBe("approaching");
    expect(bandwidthCapStatus(99, 100)).toBe("approaching");
    expect(bandwidthCapStatus(100, 100)).toBe("over");
  });

  it("has no warning status when the optional cap is clear", () => {
    expect(bandwidthCapStatus(9_999_999, null)).toBe("ok");
  });
});
