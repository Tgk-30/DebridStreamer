// Extra coverage for src/services/metadata/OMDBService.ts - the defensive parse
// branches and error mappings the primary OMDBService.test.ts doesn't reach:
//  - parseDouble rejecting a value with trailing junk ("8x") via isFullNumber,
//  - parseIntStrict rejecting a non-integer literal ("8.5", "12abc"),
//  - rottenTomatoesPercent clamping an out-of-range percent to 0..100,
//  - a non-JSON body mapped to invalidResponse,
//  - a "Response":"False" body with no Error message falling back to the imdb id,
//  - constructing the service with no injected fetch (default-fetch branch).
//
// Reuses the FetchImpl-stub pattern from OMDBService.test.ts. TESTS ONLY.

import { describe, expect, it, vi } from "vitest";
import { type FetchImpl, OMDBService } from "./OMDBService";

function fetchReturning(status: number, body: string): FetchImpl {
  return async () => ({ status, text: async () => body });
}

const okBody = (obj: Record<string, unknown>): FetchImpl =>
  fetchReturning(200, JSON.stringify({ Response: "True", ...obj }));

describe("OMDBService defensive numeric parsing", () => {
  it("rejects an imdbRating with trailing junk (Swift strict Double semantics)", async () => {
    const service = new OMDBService("k", okBody({ imdbRating: "8x" }));
    const ratings = await service.fetchRatings("tt1");
    expect(ratings.imdbRating).toBeUndefined();
  });

  it("rejects a non-integer Metascore (Swift strict Int semantics)", async () => {
    const decimal = new OMDBService("k", okBody({ Metascore: "8.5" }));
    expect((await decimal.fetchRatings("tt1")).metascore).toBeUndefined();

    const trailing = new OMDBService("k", okBody({ Metascore: "12abc" }));
    expect((await trailing.fetchRatings("tt1")).metascore).toBeUndefined();
  });

  it("accepts a signed integer Metascore", async () => {
    const service = new OMDBService("k", okBody({ Metascore: "+63" }));
    expect((await service.fetchRatings("tt1")).metascore).toBe(63);
  });

  it("maps parseIntStrict NaN to undefined for malformed integer literals", async () => {
    const parseIntSpy = vi.spyOn(Number, "parseInt").mockImplementation(() => Number.NaN);
    try {
      const service = new OMDBService("k", okBody({ Metascore: "63" }));
      expect((await service.fetchRatings("tt1")).metascore).toBeUndefined();
    } finally {
      parseIntSpy.mockRestore();
    }
  });

  it("clamps an out-of-range Rotten Tomatoes percent into 0..100", async () => {
    const service = new OMDBService(
      "k",
      okBody({ Ratings: [{ Source: "Rotten Tomatoes", Value: "175%" }] }),
    );
    expect((await service.fetchRatings("tt1")).rtPercent).toBe(100);
  });

  it("ignores a Rotten Tomatoes value with no digits", async () => {
    const service = new OMDBService(
      "k",
      okBody({ Ratings: [{ Source: "Rotten Tomatoes", Value: "Fresh" }] }),
    );
    expect((await service.fetchRatings("tt1")).rtPercent).toBeUndefined();
  });

  it("maps rotten tomatoes parseInt NaN to undefined", async () => {
    const original = Number.parseInt;
    const parseIntSpy = vi.spyOn(Number, "parseInt").mockImplementation((value, radix) =>
      value === "74" ? Number.NaN : original(value, radix),
    );
    try {
      const service = new OMDBService(
        "k",
        okBody({ Ratings: [{ Source: "Rotten Tomatoes", Value: "74%" }] }),
      );
      expect((await service.fetchRatings("tt1")).rtPercent).toBeUndefined();
    } finally {
      parseIntSpy.mockRestore();
    }
  });
});

describe("OMDBService error mapping", () => {
  it("maps a non-JSON body to an invalidResponse error", async () => {
    const service = new OMDBService("k", fetchReturning(200, "<html>not json</html>"));
    await expect(service.fetchRatings("tt1")).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("falls back to the imdb id as the notFound detail when Error is absent", async () => {
    const service = new OMDBService("k", fetchReturning(200, JSON.stringify({ Response: "False" })));
    await expect(service.fetchRatings("ttmissing")).rejects.toMatchObject({
      kind: "notFound",
      detail: "ttmissing",
    });
  });

  it("treats a lowercase 'false' Response as notFound", async () => {
    const service = new OMDBService(
      "k",
      fetchReturning(200, JSON.stringify({ Response: "false", Error: "Nope." })),
    );
    await expect(service.fetchRatings("ttx")).rejects.toMatchObject({
      kind: "notFound",
      detail: "Nope.",
    });
  });
});

describe("OMDBService default fetch wiring", () => {
  it("constructs without an injected fetch (uses the global fetch by default)", () => {
    // Just exercising the default-fetch constructor branch; no call is made so
    // no real network is hit.
    const service = new OMDBService("k");
    expect(service).toBeInstanceOf(OMDBService);
  });

  it("uses the global fetch when no fetch implementation is passed in", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          Response: "True",
          imdbRating: "8.8",
          Metascore: "77",
          Ratings: [{ Source: "Rotten Tomatoes", Value: "91%" }],
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const service = new OMDBService("k");
      const ratings = await service.fetchRatings("tt1234");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(ratings.imdbRating).toBe(8.8);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps an invalid URL into an invalidURL OMDBError", async () => {
    const service = new OMDBService("k");
    (service as unknown as { baseURL: string }).baseURL = "://bad-url";
    await expect(service.fetchRatings("tt1")).rejects.toMatchObject({
      kind: "invalidURL",
    });
  });
});
