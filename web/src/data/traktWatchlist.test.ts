import { describe, expect, it, vi } from "vitest";
import type { MediaPreview } from "../models/media";
import { collectTraktWatchlistPushCandidates } from "./traktWatchlist";

function preview(id: string, type: MediaPreview["type"] = "movie"): MediaPreview {
  return { id, type, title: id };
}

describe("collectTraktWatchlistPushCandidates", () => {
  it("keeps direct IMDb movie IDs", async () => {
    const getExternalIds = vi.fn();
    const result = await collectTraktWatchlistPushCandidates(
      [preview("tt0133093")],
      { getExternalIds },
    );

    expect(result).toEqual({ imdbIDs: ["tt0133093"], skipped: 0, seriesExcluded: 0 });
    expect(getExternalIds).not.toHaveBeenCalled();
  });

  it("reconciles TMDB movie IDs through external IDs", async () => {
    const getExternalIds = vi.fn(async () => ({ imdbId: "tt1160419" }));
    const result = await collectTraktWatchlistPushCandidates(
      [preview("tmdb-438631")],
      { getExternalIds },
    );

    expect(getExternalIds).toHaveBeenCalledWith(438631, "movie");
    expect(result).toEqual({ imdbIDs: ["tt1160419"], skipped: 0, seriesExcluded: 0 });
  });

  it("counts unresolved movies and excludes series", async () => {
    const getExternalIds = vi.fn(async () => ({ imdbId: null }));
    const result = await collectTraktWatchlistPushCandidates(
      [preview("tmdb-1"), preview("local-movie"), preview("tt0944947", "series")],
      { getExternalIds },
    );

    expect(result).toEqual({ imdbIDs: [], skipped: 2, seriesExcluded: 1 });
  });
});
