// Pure display-helper tests for the media domain models (no DOM/network).

import { describe, expect, it } from "vitest";
import {
  CastMember,
  Episode,
  MediaItem,
  MediaPreview,
  MediaType,
  makeCastMember,
} from "./media";

const IMG = "https://image.tmdb.org/t/p";

function preview(over: Partial<MediaPreview> = {}): MediaPreview {
  return { id: "tt1", type: "movie", title: "X", ...over };
}
function item(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "tt1",
    type: "movie",
    title: "X",
    genres: [],
    lastFetched: "2020-01-01T00:00:00Z",
    ...over,
  };
}

describe("MediaType", () => {
  it("displayName maps both kinds", () => {
    expect(MediaType.displayName("movie")).toBe("Movie");
    expect(MediaType.displayName("series")).toBe("TV Show");
  });
  it("tmdbPath maps both kinds", () => {
    expect(MediaType.tmdbPath("movie")).toBe("movie");
    expect(MediaType.tmdbPath("series")).toBe("tv");
  });
  it("exposes the literal constants", () => {
    expect(MediaType.movie).toBe("movie");
    expect(MediaType.series).toBe("series");
  });
});

describe("MediaPreview helpers", () => {
  it("posterURL builds a w342 URL or null", () => {
    expect(MediaPreview.posterURL(preview({ posterPath: "/p.jpg" }))).toBe(
      `${IMG}/w342/p.jpg`,
    );
    expect(MediaPreview.posterURL(preview({ posterPath: null }))).toBeNull();
    expect(MediaPreview.posterURL(preview())).toBeNull(); // undefined
    expect(MediaPreview.posterURL(preview({ posterPath: "" }))).toBeNull(); // empty falsy
  });
  it("backdropURL builds a w1280 URL or null", () => {
    expect(MediaPreview.backdropURL(preview({ backdropPath: "/b.jpg" }))).toBe(
      `${IMG}/w1280/b.jpg`,
    );
    expect(MediaPreview.backdropURL(preview({ backdropPath: null }))).toBeNull();
    expect(MediaPreview.backdropURL(preview())).toBeNull();
  });
  it("ratingString formats to 1 decimal, '' when missing", () => {
    expect(MediaPreview.ratingString(preview({ imdbRating: 8.27 }))).toBe("8.3");
    expect(MediaPreview.ratingString(preview({ imdbRating: 0 }))).toBe("0.0");
    expect(MediaPreview.ratingString(preview({ imdbRating: null }))).toBe("");
    expect(MediaPreview.ratingString(preview())).toBe("");
  });
});

describe("MediaItem helpers", () => {
  it("poster/backdrop/thumbnail URLs use the right sizes", () => {
    expect(MediaItem.posterURL(item({ posterPath: "/p.jpg" }))).toBe(
      `${IMG}/w500/p.jpg`,
    );
    expect(MediaItem.posterThumbnailURL(item({ posterPath: "/p.jpg" }))).toBe(
      `${IMG}/w342/p.jpg`,
    );
    expect(MediaItem.backdropURL(item({ backdropPath: "/b.jpg" }))).toBe(
      `${IMG}/w1280/b.jpg`,
    );
    expect(MediaItem.posterURL(item({ posterPath: null }))).toBeNull();
    expect(MediaItem.posterThumbnailURL(item())).toBeNull();
    expect(MediaItem.backdropURL(item())).toBeNull();
  });
  it("yearString stringifies or returns ''", () => {
    expect(MediaItem.yearString(item({ year: 1999 }))).toBe("1999");
    expect(MediaItem.yearString(item({ year: null }))).toBe("");
    expect(MediaItem.yearString(item())).toBe("");
  });
  it("ratingString formats or returns 'N/A'", () => {
    expect(MediaItem.ratingString(item({ imdbRating: 7.0 }))).toBe("7.0");
    expect(MediaItem.ratingString(item({ imdbRating: 0 }))).toBe("0.0");
    expect(MediaItem.ratingString(item({ imdbRating: null }))).toBe("N/A");
    expect(MediaItem.ratingString(item())).toBe("N/A");
  });
  it("runtimeString covers minutes, hours+minutes, and the empty cases", () => {
    expect(MediaItem.runtimeString(item({ runtime: 45 }))).toBe("45m");
    expect(MediaItem.runtimeString(item({ runtime: 60 }))).toBe("1h 0m");
    expect(MediaItem.runtimeString(item({ runtime: 90 }))).toBe("1h 30m");
    expect(MediaItem.runtimeString(item({ runtime: 125 }))).toBe("2h 5m");
    expect(MediaItem.runtimeString(item({ runtime: 0 }))).toBe("");
    expect(MediaItem.runtimeString(item({ runtime: -10 }))).toBe("");
    expect(MediaItem.runtimeString(item({ runtime: null }))).toBe("");
    expect(MediaItem.runtimeString(item())).toBe("");
  });
});

describe("makeCastMember", () => {
  it("derives a w185 profile URL when a path is present", () => {
    const c: CastMember = makeCastMember(5, "Jane", "Hero", "/face.jpg");
    expect(c).toEqual({
      id: 5,
      name: "Jane",
      character: "Hero",
      profileURL: `${IMG}/w185/face.jpg`,
    });
  });
  it("yields a null profileURL for missing/empty paths", () => {
    expect(makeCastMember(1, "A", "B", null).profileURL).toBeNull();
    expect(makeCastMember(1, "A", "B", undefined).profileURL).toBeNull();
    expect(makeCastMember(1, "A", "B", "").profileURL).toBeNull();
  });
});

describe("type shapes stay structurally valid", () => {
  it("an Episode literal compiles + round-trips its required fields", () => {
    const ep: Episode = {
      id: "tt1:s1e1",
      mediaId: "tt1",
      seasonNumber: 1,
      episodeNumber: 1,
    };
    expect(ep.mediaId).toBe("tt1");
  });
});
