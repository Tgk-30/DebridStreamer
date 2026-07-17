import { describe, expect, it } from "vitest";
import {
  withDataSaverClamp,
  rowMatchesStreamFilters,
  combineStreamResults,
} from "../src/media-runtime.js";

interface Filters {
  cachedOnly: boolean;
  maxQuality: string;
  maxSizeGB: number;
}

function row(quality: string, sizeGB: number, cachedOn: string | null = "real_debrid") {
  return { result: { quality, sizeBytes: sizeGB * 1024 * 1024 * 1024 }, cachedOn };
}

describe("withDataSaverClamp (server - must mirror client effectiveDataSaver)", () => {
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

// The imdb+title merge is the heart of the Server-Mode dual search. It's the
// SAME shared helper Local Mode uses, so testing it here guards the server's
// wiring + documents the two invariants that keep the two modes identical:
// title-pass validation and infoHash dedup.
function tr(infoHash: string, title: string, seeders: number, quality = "1080p") {
  return { infoHash, title, seeders, quality };
}

describe("combineStreamResults (server dual-search merge - mirrors client)", () => {
  it("adds title-pass results the imdb pass missed (the whole point of the pass)", () => {
    const byImdb = [tr("aaa", "The Bear S01E06 1080p", 100)];
    const byTitle = [tr("bbb", "The Bear S01E06 APIBay 720p", 50, "720p")];
    const merged = combineStreamResults(byImdb, byTitle, "The Bear");
    expect(merged.map((r) => r.infoHash).sort()).toEqual(["aaa", "bbb"]);
  });

  it("drops a DIFFERENT show even when it shares the title's words", () => {
    const byImdb = [tr("aaa", "The Bear S01E06", 100)];
    const byTitle = [
      tr("ccc", "Yellowstone S01E06 1080p", 80), // shares no title word
      tr("ddd", "The Adventures Of Paddington Bear S01E06", 70), // shares "the"+"bear"
    ];
    // Only the exact-phrase "The Bear" release survives - the title pass is a
    // contiguous whole-word match, not a loose all-words-present match.
    const merged = combineStreamResults(byImdb, byTitle, "The Bear");
    expect(merged.map((r) => r.infoHash)).toEqual(["aaa"]);
  });

  it("keeps a title-pass release that spells '&' as 'and' (connector fold)", () => {
    const byTitle = [tr("dd", "Dungeons.and.Dragons.Honor.Among.Thieves.2023.1080p", 40)];
    const merged = combineStreamResults([], byTitle, "Dungeons & Dragons: Honor Among Thieves");
    expect(merged.map((r) => r.infoHash)).toEqual(["dd"]);
  });

  it("does NOT validate when no title is given (imdb-only / capped path)", () => {
    // The route passes title=null for kids; byTitle is empty there anyway, but
    // the combiner must not throw and must return the imdb pass untouched.
    const byImdb = [tr("aaa", "Whatever", 10)];
    expect(combineStreamResults(byImdb, [], null).map((r) => r.infoHash)).toEqual([
      "aaa",
    ]);
  });

  it("dedupes the same torrent across passes, keeping the higher-seeder copy", () => {
    const byImdb = [tr("HASH", "Dune Part Two 2160p", 20, "4K")];
    const byTitle = [tr("hash", "Dune Part Two 2160p", 900, "4K")];
    const merged = combineStreamResults(byImdb, byTitle, "Dune Part Two");
    expect(merged).toHaveLength(1);
    expect(merged[0].seeders).toBe(900);
  });

  it("sorts by quality then seeders so the best stream leads", () => {
    const merged = combineStreamResults(
      [tr("a", "Movie 720p", 500, "720p"), tr("b", "Movie 4K", 10, "4K")],
      [],
      "Movie",
    );
    expect(merged.map((r) => r.infoHash)).toEqual(["b", "a"]);
  });

  it("down-ranks wrong-year releases when a movie year is given (Odyssey case)", () => {
    // The v0.9.3 CV QA bug, exercised through the server's re-export: The
    // Odyssey (2026)'s sources led with the 1997/2016 adaptations. With the
    // movie year, wrong-year releases sink below year-compatible AND
    // no-year ones (never dropped); yearless calls keep the old order.
    const byTitle = [
      tr("y1997", "The.Odyssey.1997.2160p.REMUX", 900, "4K"),
      tr("y2016", "The Odyssey (2016) 1080p WEBRip", 300),
      tr("noyear", "The.Odyssey.1080p.WEB.H264-GRP", 100),
      tr("y2026", "The.Odyssey.2026.1080p.WEB-DL", 40),
    ];
    const ranked = combineStreamResults([], byTitle, "The Odyssey", 2026);
    expect(ranked.map((r) => r.infoHash)).toEqual(["noyear", "y2026", "y1997", "y2016"]);
    const unranked = combineStreamResults([], byTitle, "The Odyssey");
    expect(unranked.map((r) => r.infoHash)).toEqual(["y1997", "y2016", "noyear", "y2026"]);
  });
});
