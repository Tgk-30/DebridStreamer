import { describe, expect, it, vi } from "vitest";
import { resolveOne, type AutoResolveDeps } from "./autoResolve";
import { defaultSettings, type AppSettings } from "../data/settings";
import { VideoQuality } from "../services/indexers/models";
import type { MediaPreview } from "../models/media";
import type { IndexerManager } from "../services/indexers/IndexerManager";
import type { DebridManager } from "../services/debrid/DebridManager";
import type { Store } from "../storage/types";

// id starts with "tt", so resolveImdbId short-circuits without needing TMDB.
const preview = { id: "tt1", type: "movie", title: "Movie" } as unknown as MediaPreview;

function settings(over: Partial<AppSettings>): AppSettings {
  return { ...defaultSettings(), ...over };
}

function torrent(infoHash: string, quality: VideoQuality, sizeGB: number) {
  return { infoHash, quality, sizeBytes: sizeGB * 1024 * 1024 * 1024 };
}

function deps(over: {
  results: ReturnType<typeof torrent>[];
  settings: AppSettings;
  resolveStream?: ReturnType<typeof vi.fn>;
}): AutoResolveDeps {
  const resolveStream =
    over.resolveStream ?? vi.fn(async () => ({ debridService: "real_debrid" }));
  return {
    tmdb: null,
    indexers: { searchAll: async () => over.results } as unknown as IndexerManager,
    debrid: {
      hasServices: true,
      checkCacheAll: async () => ({}),
      resolveStream,
    } as unknown as DebridManager,
    store: { putCachedResolution: async () => {} } as unknown as Store,
    settings: over.settings,
  };
}

describe("resolveOne — data-saver-aware auto-pick", () => {
  // Quality-sorted best-first, as the indexers return them.
  const results = [
    torrent("4k", VideoQuality.uhd4k, 60),
    torrent("720p", VideoQuality.hd720p, 4),
  ];

  it("picks the within-cap source when Data Saver clamps quality (the bug fix)", async () => {
    const record = await resolveOne(preview, deps({ results, settings: settings({ dataSaver: true }) }));
    // Not the over-cap 4K, even though it's first/best — auto-pick now respects the cap.
    expect(record?.infoHash).toBe("720p");
  });

  it("picks the best (4K) when Data Saver is off (no regression)", async () => {
    const record = await resolveOne(preview, deps({ results, settings: settings({ dataSaver: false }) }));
    expect(record?.infoHash).toBe("4k");
  });

  it("skips pre-caching when cached-only is on and nothing instant fits the caps", async () => {
    const resolveStream = vi.fn(async () => ({ debridService: "real_debrid" }));
    const record = await resolveOne(
      preview,
      deps({
        results: [torrent("720p", VideoQuality.hd720p, 4)], // present but uncached
        settings: settings({ streamCachedOnly: true }),
        resolveStream,
      }),
    );
    expect(record).toBeNull();
    expect(resolveStream).not.toHaveBeenCalled(); // never triggers a download
  });
});
