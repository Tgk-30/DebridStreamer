import { describe, expect, it } from "vitest";
import {
  buildTitleQuery,
  filterResultsByTitle,
  combineStreamResults,
} from "./streamMatching";
import type { TorrentResult } from "../services/indexers/models";
import { VideoQuality } from "../services/indexers/models";

function tr(
  infoHash: string,
  title: string,
  seeders = 1,
  quality: VideoQuality = VideoQuality.hd1080p,
): TorrentResult {
  return {
    infoHash,
    title,
    seeders,
    quality,
    leechers: 0,
    sizeBytes: 0,
    magnetURI: "",
    source: "test",
  } as unknown as TorrentResult;
}

describe("buildTitleQuery", () => {
  it("appends a zero-padded SxxEyy tag for an episode", () => {
    expect(buildTitleQuery("The Bear", 1, 6)).toBe("The Bear S01E06");
    expect(buildTitleQuery("Severance", 12, 3)).toBe("Severance S12E03");
  });
  it("is the bare (trimmed) title for a movie", () => {
    expect(buildTitleQuery("  Oppenheimer  ", null, null)).toBe("Oppenheimer");
  });
});

describe("filterResultsByTitle — contiguous whole-word phrase", () => {
  it("keeps releases that lead with the title regardless of separators/case", () => {
    const kept = filterResultsByTitle(
      [
        tr("a", "The.Bear.S01E01.1080p.WEB-DL"),
        tr("b", "the bear s01e01 XviD-AFG"),
      ],
      "The Bear",
    );
    expect(kept.map((r) => r.infoHash)).toEqual(["a", "b"]);
  });

  it("rejects a DIFFERENT show that merely shares the title's words", () => {
    // The exact false positive seen live: both "the" and "bear" appear, but not
    // as the contiguous phrase "the bear".
    const kept = filterResultsByTitle(
      [tr("x", "The.Adventures.Of.Paddington.Bear.S01E01.WEB")],
      "The Bear",
    );
    expect(kept).toEqual([]);
  });

  it("rejects a same-SxxEyy wrong show", () => {
    const kept = filterResultsByTitle(
      [tr("y", "Yellowstone S01E06 1080p")],
      "The Bear",
    );
    expect(kept).toEqual([]);
  });

  it("folds & vs 'and' so a spelled-out connector still matches", () => {
    const kept = filterResultsByTitle(
      [
        tr("dd", "Dungeons.and.Dragons.Honor.Among.Thieves.2023.1080p.WEB-DL"),
        tr("tj", "Tom.and.Jerry.2021.1080p"),
      ],
      "Dungeons & Dragons: Honor Among Thieves",
    );
    // The D&D release survives the &→and fold; Tom & Jerry is a different title.
    expect(kept.map((r) => r.infoHash)).toEqual(["dd"]);
    expect(filterResultsByTitle([tr("tj", "Tom.and.Jerry.2021")], "Tom & Jerry")).toHaveLength(1);
  });

  it("matches single/short titles only on a whole-word boundary", () => {
    const kept = filterResultsByTitle(
      [tr("hit", "It 2017 1080p"), tr("miss", "Bitcoin Heist 1080p")],
      "It",
    );
    expect(kept.map((r) => r.infoHash)).toEqual(["hit"]);
  });

  it("passes everything through for an empty title", () => {
    const all = [tr("a", "Anything")];
    expect(filterResultsByTitle(all, "")).toBe(all);
  });
});

describe("combineStreamResults", () => {
  it("merges imdb + validated title pass, dedupes by hash, sorts best-first", () => {
    const byImdb = [tr("A", "The Bear S01E01 720p", 5, VideoQuality.hd720p)];
    const byTitle = [
      tr("B", "The Bear S01E01 2160p", 40, VideoQuality.uhd4k),
      tr("nope", "Paddington Bear S01E01", 999),
    ];
    const merged = combineStreamResults(byImdb, byTitle, "The Bear");
    // Paddington dropped; 4K leads on quality; hash A survives.
    expect(merged.map((r) => r.infoHash)).toEqual(["B", "A"]);
  });
});
