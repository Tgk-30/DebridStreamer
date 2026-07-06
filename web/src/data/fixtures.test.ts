import { describe, expect, it } from "vitest";
import { loadDiscoverFixtures } from "./fixtures";

describe("loadDiscoverFixtures", () => {
  it("maps TMDB fixture seeds into movie and tv previews", () => {
    const catalog = loadDiscoverFixtures();

    expect(catalog.trendingMovies[0]).toMatchObject({
      id: "tmdb-27205",
      type: "movie",
      title: "Inception",
      year: 2010,
      imdbRating: 8.4,
      tmdbId: 27205,
    });
    expect(catalog.trendingMovies[0]?.backdropPath).toBe("/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg");

    expect(catalog.popularMovies[0]?.backdropPath).toBeNull();
    expect(catalog.popularMovies[0]?.id).toBe("tmdb-299536");

    expect(catalog.trendingTV[0]).toMatchObject({
      id: "tmdb-1396",
      type: "series",
      title: "Breaking Bad",
      year: 2008,
      imdbRating: 8.9,
      tmdbId: 1396,
    });
    expect(catalog.trendingTV[0]?.backdropPath).toBe("/9faGSphHrZYQz5MtBT5l4Yqfa6P.jpg");
  });

  it("always prefixes ids with tmdb- and normalizes missing backdrop to null", () => {
    const catalog = loadDiscoverFixtures();

    expect(catalog.trendingMovies.every((item) => item.id.startsWith("tmdb-"))).toBe(true);
    expect(catalog.upcomingMovies.some((item) => item.backdropPath == null)).toBe(true);
    expect(catalog.popularMovies.some((item) => item.backdropPath == null)).toBe(true);
  });
});
