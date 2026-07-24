import { describe, expect, it } from "vitest";
import type { StreamRow } from "./streams";
import {
  actionableProviderError,
  assessSource,
  rankSources,
  sourceSignals,
} from "./sourceIntelligence";
import { TorrentResult } from "../services/indexers/models";

function row(
  title: string,
  options: Partial<Pick<StreamRow, "cachedOn" | "cacheStatus">> & {
    sizeBytes?: number;
    seeders?: number;
  } = {},
): StreamRow {
  return {
    result: TorrentResult.fromSearch({
      infoHash: title.replace(/\W/g, "").slice(0, 40).padEnd(40, "a"),
      title,
      sizeBytes: options.sizeBytes ?? 8 * 1024 ** 3,
      seeders: options.seeders ?? 30,
      leechers: 0,
      indexerName: "Test",
    }),
    cachedOn: options.cachedOn ?? null,
    cacheStatus: options.cacheStatus ?? "not_cached",
  };
}

describe("source intelligence", () => {
  it("parses HDR, Dolby Vision, REMUX, containers, and estimated bitrate", () => {
    const assessed = sourceSignals(
      row("Film.2160p.REMUX.DV.HDR10+.HEVC.mkv", { sizeBytes: 54 * 1024 ** 3 }),
      120,
    );
    expect(assessed).toMatchObject({
      hdr: "Dolby Vision",
      remux: true,
      container: "MKV",
    });
    expect(assessed.estimatedMbps).toBeGreaterThan(60);
  });

  it("conservatively recommends an instant compatible source, not raw quality", () => {
    const risky4k = row("Film.2160p.DV.REMUX.HEVC.mkv", {
      cachedOn: "real_debrid",
      sizeBytes: 80 * 1024 ** 3,
      seeders: 100,
    });
    const compatible = row("Film.1080p.WEB-DL.H264.AAC.mp4", {
      cachedOn: "real_debrid",
      sizeBytes: 7 * 1024 ** 3,
      seeders: 30,
    });
    const ranked = rankSources([risky4k, compatible], {
      profile: "browser-direct",
      runtimeMinutes: 110,
    });
    expect(ranked[0]!.row).toBe(compatible);
    expect(ranked[0]!.recommended).toBe(true);
    expect(ranked[1]!.assessment.compatibility).toBe("risky");
  });

  it("keeps native playback capable of recommending HEVC", () => {
    const native = assessSource(
      row("Film.2160p.HDR10.HEVC.WEB-DL.mkv", { cachedOn: "real_debrid" }),
      { profile: "native" },
    );
    expect(native.compatibility).toBe("native");
    expect(native.reasons).toContain("HDR10");
  });

  it("does not call an unknown browser codec broadly compatible", () => {
    const unknown = assessSource(
      row("Film.1080p.WEB-DL.Unknown.mp4", { cachedOn: "real_debrid" }),
      { profile: "browser-direct" },
    );
    expect(unknown.compatibility).toBe("risky");
  });

  it("does not recommend an unknown browser container as direct play", () => {
    const unknown = assessSource(
      row("Film.1080p.WEB-DL.H264.AAC", { cachedOn: "real_debrid" }),
      { profile: "browser-direct" },
    );
    expect(unknown.compatibility).toBe("risky");
  });

  it("translates provider failures into recovery actions", () => {
    expect(actionableProviderError(new Error("HTTP 401"))).toContain("Reconnect");
    expect(actionableProviderError(new Error("429 rate limit"))).toContain("Wait");
    expect(actionableProviderError(new Error("no playable files"))).toContain(
      "another source",
    );
  });
});
