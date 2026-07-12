import { describe, expect, it } from "vitest";
import { fitVideoRect } from "./videoRect";

describe("fitVideoRect", () => {
  it("letterboxes a wide video in a tall window (full width, bars top/bottom)", () => {
    const rect = fitVideoRect({ width: 1920, height: 1080 }, { width: 1000, height: 1000 });
    expect(rect).not.toBeNull();
    // 16:9 into a square: fills the width, centered vertically.
    expect(rect).toEqual({ left: 0, top: 218.75, width: 1000, height: 562.5 });
  });

  it("pillarboxes a tall video in a wide window (full height, bars left/right)", () => {
    const rect = fitVideoRect({ width: 1080, height: 1920 }, { width: 1600, height: 900 });
    expect(rect).not.toBeNull();
    // 9:16 into 16:9: fills the height, centered horizontally.
    expect(rect).toEqual({ left: 546.875, top: 0, width: 506.25, height: 900 });
  });

  it("fills exactly when aspect matches (no bars)", () => {
    const rect = fitVideoRect({ width: 1920, height: 1080 }, { width: 1280, height: 720 });
    expect(rect).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
  });

  it("returns null when the video dimensions are unknown", () => {
    expect(fitVideoRect({ width: 0, height: 0 }, { width: 1280, height: 720 })).toBeNull();
    expect(fitVideoRect({ width: 1920, height: 0 }, { width: 1280, height: 720 })).toBeNull();
  });

  it("waits for both dimension events before fitting", () => {
    expect(fitVideoRect({ width: 1920, height: 0 }, { width: 1440, height: 900 })).toBeNull();
    expect(fitVideoRect({ width: 0, height: 1080 }, { width: 1440, height: 900 })).toBeNull();
  });

  it("returns null when the container has not been measured yet", () => {
    expect(fitVideoRect({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toBeNull();
  });

  it("ignores negative or non-finite dimensions", () => {
    expect(fitVideoRect({ width: -1920, height: 1080 }, { width: 1280, height: 720 })).toBeNull();
    expect(fitVideoRect({ width: 1920, height: 1080 }, { width: Number.NaN, height: 720 })).toBeNull();
    expect(fitVideoRect({ width: Number.POSITIVE_INFINITY, height: 1080 }, { width: 1280, height: 720 })).toBeNull();
    expect(fitVideoRect({ width: 1920, height: 1080 }, { width: 1280, height: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("uses Retina-sized video dimensions only for their aspect ratio", () => {
    expect(fitVideoRect({ width: 3840, height: 2160 }, { width: 1440, height: 900 })).toEqual({
      left: 0,
      top: 45,
      width: 1440,
      height: 810,
    });
  });
});
