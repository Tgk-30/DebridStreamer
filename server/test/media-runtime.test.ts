import { describe, expect, it } from "vitest";
import { withDataSaverClamp, rowMatchesStreamFilters } from "../src/media-runtime.js";

interface Filters {
  cachedOnly: boolean;
  maxQuality: string;
  maxSizeGB: number;
}

function row(quality: string, sizeGB: number, cachedOn: string | null = "real_debrid") {
  return { result: { quality, sizeBytes: sizeGB * 1024 * 1024 * 1024 }, cachedOn };
}

describe("withDataSaverClamp (server — must mirror client effectiveDataSaver)", () => {
  it("is a no-op when Data Saver is off", () => {
    const f: Filters = { cachedOnly: false, maxQuality: "4K", maxSizeGB: 50 };
    expect(withDataSaverClamp(f, false)).toBe(f);
  });

  it("clamps an uncapped profile to 720p / 5 GB", () => {
    expect(
      withDataSaverClamp({ cachedOnly: false, maxQuality: "any", maxSizeGB: 0 }, true),
    ).toEqual({ cachedOnly: false, maxQuality: "720p", maxSizeGB: 5 });
  });

  it("clamps a looser cap down but keeps a stricter one (min, never loosen)", () => {
    expect(
      withDataSaverClamp({ cachedOnly: true, maxQuality: "1080p", maxSizeGB: 50 }, true),
    ).toEqual({ cachedOnly: true, maxQuality: "720p", maxSizeGB: 5 });
    expect(
      withDataSaverClamp({ cachedOnly: false, maxQuality: "480p", maxSizeGB: 2 }, true),
    ).toEqual({ cachedOnly: false, maxQuality: "480p", maxSizeGB: 2 });
  });
});

describe("rowMatchesStreamFilters", () => {
  it("respects the Data-Saver-clamped quality + size", () => {
    const filters = withDataSaverClamp(
      { cachedOnly: false, maxQuality: "any", maxSizeGB: 0 },
      true,
    );
    expect(rowMatchesStreamFilters(row("1080p", 12), filters)).toBe(false); // over 720p
    expect(rowMatchesStreamFilters(row("720p", 4), filters)).toBe(true);
    expect(rowMatchesStreamFilters(row("720p", 8), filters)).toBe(false); // over 5 GB
  });

  it("honors cached-only", () => {
    const filters: Filters = { cachedOnly: true, maxQuality: "any", maxSizeGB: 0 };
    expect(rowMatchesStreamFilters(row("720p", 1, null), filters)).toBe(false);
    expect(rowMatchesStreamFilters(row("720p", 1, "real_debrid"), filters)).toBe(true);
  });
});
