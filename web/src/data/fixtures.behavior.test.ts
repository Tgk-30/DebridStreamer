import { describe, expect, it } from "vitest";
import { loadDiscoverFixtures } from "./fixtures";

type DiscoverFixture = ReturnType<typeof loadDiscoverFixtures>;

describe("fixtures behavior invariants", () => {
  it("returns independent catalog objects and arrays across invocations", () => {
    const first = loadDiscoverFixtures();
    const second = loadDiscoverFixtures();
    const keys: Array<keyof DiscoverFixture> = [
      "trendingMovies",
      "trendingTV",
      "popularMovies",
      "topRatedMovies",
      "nowPlayingMovies",
      "upcomingMovies",
    ];

    expect(first).not.toBe(second);

    keys.forEach((key) => {
      expect(first[key]).not.toBe(second[key]);
      expect(first[key][0]).not.toBe(second[key][0]);
    });
  });

  it("keeps fixture mapping deterministic and stable", () => {
    const fixtures = loadDiscoverFixtures();
    const secondRun = loadDiscoverFixtures();

    expect(fixtures.trendingMovies[0]?.id).toBe("tmdb-27205");
    expect(fixtures.trendingMovies[0]?.title).toBe("Inception");
    expect(secondRun.trendingMovies[0]?.backdropPath).toBe("/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg");
    expect(secondRun.trendingMovies.length).toBe(8);
    expect(secondRun.upcomingMovies.length).toBe(6);
  });

  it("preserves fixture ids while normalizing backdrop values to strings and null", () => {
    const fixtures = loadDiscoverFixtures();

    expect(fixtures.popularMovies.every((item) => item.id.startsWith("tmdb-"))).toBe(true);
    expect(fixtures.popularMovies.some((item) => item.backdropPath == null)).toBe(true);
    expect(fixtures.upcomingMovies.some((item) => item.backdropPath == null)).toBe(true);
  });
});
