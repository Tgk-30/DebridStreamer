// Pure logic tests for the storage domain models (progress math, folder/list
// helpers, indexer-config defaulting).

import { describe, expect, it } from "vitest";
import {
  defaultEndpointPath,
  defaultProviderSubtype,
  hasResumePoint,
  listTypeSupportsFolders,
  makeIndexerConfigRecord,
  systemFolderID,
  systemFolderName,
  watchProgressMap,
  watchProgressPercent,
  type WatchHistoryRecord,
} from "./models";

function hist(
  progressSeconds: number,
  durationSeconds: number | null,
  over: Partial<WatchHistoryRecord> = {},
): WatchHistoryRecord {
  const mediaId = over.mediaId ?? "tt1";
  return {
    id: `${mediaId}:`,
    mediaId,
    episodeId: null,
    progressSeconds,
    durationSeconds,
    completed: false,
    lastWatched: "2020-01-01T00:00:00Z",
    streamQuality: null,
    preview: { id: mediaId, type: "movie", title: "X" },
    ...over,
  };
}

describe("watchProgressPercent", () => {
  it("returns a clamped 0..1 fraction", () => {
    expect(watchProgressPercent(hist(0, 100))).toBe(0);
    expect(watchProgressPercent(hist(50, 100))).toBe(0.5);
    expect(watchProgressPercent(hist(100, 100))).toBe(1);
  });
  it("caps overruns at 1", () => {
    expect(watchProgressPercent(hist(150, 100))).toBe(1);
  });
  it("guards against missing / zero / negative duration", () => {
    expect(watchProgressPercent(hist(50, null))).toBe(0);
    expect(watchProgressPercent(hist(50, 0))).toBe(0);
    expect(watchProgressPercent(hist(50, -10))).toBe(0);
  });
});

describe("hasResumePoint", () => {
  it("is true only strictly between 2% and 95%", () => {
    expect(hasResumePoint(hist(50, 100))).toBe(true);
    expect(hasResumePoint(hist(3, 100))).toBe(true);
    expect(hasResumePoint(hist(94, 100))).toBe(true);
  });
  it("excludes the boundaries and the not-started / finished ends", () => {
    expect(hasResumePoint(hist(2, 100))).toBe(false); // exactly 2% (not > 2%)
    expect(hasResumePoint(hist(95, 100))).toBe(false); // exactly 95% (not < 95%)
    expect(hasResumePoint(hist(0, 100))).toBe(false);
    expect(hasResumePoint(hist(100, 100))).toBe(false);
    expect(hasResumePoint(hist(50, null))).toBe(false); // 0% via guard
  });
});

describe("watchProgressMap", () => {
  it("maps mediaId -> fraction for incomplete records with a resume point", () => {
    const map = watchProgressMap([
      hist(50, 100, { mediaId: "a" }),
      hist(30, 100, { mediaId: "b" }),
    ]);
    expect(map).toEqual({ a: 0.5, b: 0.3 });
  });
  it("omits finished, completed, and not-yet-started records", () => {
    const map = watchProgressMap([
      hist(50, 100, { mediaId: "resumable" }),
      hist(50, 100, { mediaId: "done", completed: true }),
      hist(98, 100, { mediaId: "basically-over" }), // > 95%
      hist(0, 100, { mediaId: "fresh" }), // 0%
    ]);
    expect(map).toEqual({ resumable: 0.5 });
  });
});

describe("list/folder helpers", () => {
  it("only watchlist lacks folders", () => {
    expect(listTypeSupportsFolders("watchlist")).toBe(false);
    expect(listTypeSupportsFolders("favorites")).toBe(true);
    expect(listTypeSupportsFolders("custom")).toBe(true);
  });
  it("systemFolderID is stable + prefixed", () => {
    expect(systemFolderID("watchlist")).toBe("system-watchlist");
    expect(systemFolderID("favorites")).toBe("system-favorites");
    expect(systemFolderID("custom")).toBe("system-custom");
  });
  it("systemFolderName maps each list type", () => {
    expect(systemFolderName("watchlist")).toBe("Watchlist");
    expect(systemFolderName("favorites")).toBe("Library");
    expect(systemFolderName("custom")).toBe("Custom");
  });
});

describe("indexer config defaulting", () => {
  it("defaultProviderSubtype covers every indexer type", () => {
    expect(defaultProviderSubtype("jackett")).toBe("jackett");
    expect(defaultProviderSubtype("prowlarr")).toBe("prowlarr");
    expect(defaultProviderSubtype("torznab")).toBe("custom_torznab");
    expect(defaultProviderSubtype("zilean")).toBe("custom_torznab");
    expect(defaultProviderSubtype("stremio_addon")).toBe("stremio_addon");
    expect(defaultProviderSubtype("built_in")).toBe("built_in");
  });
  it("defaultEndpointPath covers every indexer type", () => {
    expect(defaultEndpointPath("jackett")).toBe(
      "/api/v2.0/indexers/all/results/torznab/api",
    );
    expect(defaultEndpointPath("prowlarr")).toBe("/api/v1/search");
    expect(defaultEndpointPath("torznab")).toBe("/api");
    expect(defaultEndpointPath("zilean")).toBe("/api");
    expect(defaultEndpointPath("stremio_addon")).toBe("");
    expect(defaultEndpointPath("built_in")).toBe("");
  });
  it("makeIndexerConfigRecord fills sensible defaults", () => {
    const rec = makeIndexerConfigRecord({
      id: "x",
      type: "jackett",
      baseURL: "http://localhost:9117",
    });
    expect(rec).toMatchObject({
      id: "x",
      type: "jackett",
      baseURL: "http://localhost:9117",
      apiKey: null,
      isActive: true,
      displayName: null,
      providerSubtype: "jackett",
      endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
      categoryFilter: null,
      priority: 0,
    });
  });
  it("makeIndexerConfigRecord honors explicit overrides", () => {
    const rec = makeIndexerConfigRecord({
      id: "y",
      type: "torznab",
      baseURL: "http://host",
      apiKey: "k",
      isActive: false,
      displayName: "My Indexer",
      providerSubtype: "custom_torznab",
      endpointPath: "/custom",
      categoryFilter: "2000,5000",
      priority: 7,
    });
    expect(rec.apiKey).toBe("k");
    expect(rec.isActive).toBe(false);
    expect(rec.displayName).toBe("My Indexer");
    expect(rec.endpointPath).toBe("/custom");
    expect(rec.categoryFilter).toBe("2000,5000");
    expect(rec.priority).toBe(7);
  });
});
