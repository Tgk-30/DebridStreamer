import { describe, expect, it, vi } from "vitest";
import { resolveAIRecommendation } from "./aiRecommendations";

describe("resolveAIRecommendation", () => {
  it("prefers an exact title and year match from metadata search", async () => {
    const search = vi.fn(async () => [
      { id: "other", type: "movie" as const, title: "Arrival", year: 2016 },
      { id: "exact", type: "movie" as const, title: "The Arrival", year: 1996 },
    ]);

    await expect(
      resolveAIRecommendation(
        { title: "The Arrival", year: 1996, reason: "test", score: 1 },
        search,
      ),
    ).resolves.toMatchObject({ id: "exact" });
    expect(search).toHaveBeenCalledWith("The Arrival", null);
  });

  it("uses the response identity when metadata search is unavailable", async () => {
    await expect(
      resolveAIRecommendation(
        {
          title: "Arrival",
          reason: "test",
          score: 1,
          mediaId: "tmdb-329865",
          mediaType: "movie",
        },
        null,
      ),
    ).resolves.toMatchObject({ id: "tmdb-329865", type: "movie" });
  });
});
