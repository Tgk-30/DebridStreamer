// Mirrors the Swift OMDBService tests:
//  - Tests/.../Services/Metadata/OMDBServiceTests.swift
//
// The Swift tests stub the network with a MockURLProtocol handler keyed per
// session, capturing the request to assert the query params. Here we inject a
// `FetchImpl` stub that plays the same role: it captures the requested URL.
// The canned JSON bodies are copied verbatim from the Swift fixtures.

import { afterEach, describe, expect, it } from "vitest";
import { type FetchImpl, OMDBService } from "./OMDBService";
import { NetworkBlockedError, setNetworkMode } from "../../lib/networkPolicy";

afterEach(() => setNetworkMode("standard"));

// MARK: - fetch stub (mirrors MockURLProtocol + makeMockSession)

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  /** The last URL requested, parsed. */
  lastURL: () => URL | null;
  /** Number of times the stub was invoked. */
  hits: () => number;
}

/** Builds a fetch stub from a handler `(url) => MockResponse`. */
function makeMockFetch(handler: (url: URL) => MockResponse): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    const { status, body } = handler(parsed);
    return {
      status,
      text: async () => body,
    };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

// MARK: - Canned JSON (same shapes as the Swift fixtures)

/** A representative full OMDB lookup body with every parseable field populated.
 * Verbatim from Swift `omdbFullBody`. */
const omdbFullBody = JSON.stringify({
  Title: "The Shawshank Redemption",
  Year: "1994",
  imdbRating: "9.3",
  imdbVotes: "2,800,000",
  Metascore: "82",
  Ratings: [
    { Source: "Internet Movie Database", Value: "9.3/10" },
    { Source: "Rotten Tomatoes", Value: "74%" },
    { Source: "Metacritic", Value: "82/100" },
  ],
  Response: "True",
});

/** Same shape, but every value OMDB can return as missing is "N/A", empty, or
 * non-numeric garbage - all must defensively decode to undefined. Verbatim from
 * Swift `omdbNAValuesBody`. */
const omdbNAValuesBody = JSON.stringify({
  Title: "Some Obscure Short",
  imdbRating: "N/A",
  Metascore: "",
  Ratings: [{ Source: "Rotten Tomatoes", Value: "N/A" }],
  Response: "True",
});

// MARK: - Full-body parse (parsesFullBody)

describe("OMDBService fetchRatings", () => {
  it("throws NetworkBlockedError in Offline mode before requesting ratings", async () => {
    const mock = makeMockFetch(() => ok(omdbFullBody));
    const service = new OMDBService("test-key", mock.fetchImpl);
    setNetworkMode("offline");

    await expect(service.fetchRatings("tt0111161")).rejects.toBeInstanceOf(
      NetworkBlockedError,
    );
    expect(mock.hits()).toBe(0);
  });

  it("requests ratings in Standard mode", async () => {
    const mock = makeMockFetch(() => ok(omdbFullBody));
    const service = new OMDBService("test-key", mock.fetchImpl);

    await expect(service.fetchRatings("tt0111161")).resolves.toMatchObject({ imdbRating: 9.3 });
    expect(mock.hits()).toBe(1);
  });

  it("caches a completed lookup and deduplicates concurrent callers", async () => {
    const mock = makeMockFetch(() => ok(omdbFullBody));
    const service = new OMDBService("test-key", mock.fetchImpl);

    const [first, second] = await Promise.all([
      service.fetchRatings("tt0111161"),
      service.fetchRatings("tt0111161"),
    ]);
    expect(first).toEqual(second);
    expect(mock.hits()).toBe(1);

    await service.fetchRatings("tt0111161");
    expect(mock.hits()).toBe(1);
  });

  it("parses a full OMDB body into imdbRating, RT percent and metascore", async () => {
    const mock = makeMockFetch(() => ok(omdbFullBody));
    const service = new OMDBService("test-key", mock.fetchImpl);

    const ratings = await service.fetchRatings("tt0111161");

    expect(ratings.imdbRating).toBe(9.3);
    expect(ratings.rtPercent).toBe(74);
    expect(ratings.metascore).toBe(82);

    // The request carries the imdb id and api key as query params.
    const url = mock.lastURL();
    expect(url).not.toBeNull();
    const query = url!.search;
    expect(query).toContain("i=tt0111161");
    expect(query).toContain("apikey=test-key");
  });

  // MARK: - Defensive parsing (defensiveParsingYieldsNil)

  it("decodes missing / N/A / garbage values to undefined without crashing", async () => {
    const mock = makeMockFetch(() => ok(omdbNAValuesBody));
    const service = new OMDBService("test-key", mock.fetchImpl);

    const ratings = await service.fetchRatings("tt0000000");

    expect(ratings.imdbRating).toBeUndefined();
    expect(ratings.rtPercent).toBeUndefined();
    expect(ratings.metascore).toBeUndefined();
  });

  // MARK: - Empty body (emptyBodyYieldsAllNil)

  it("decodes a body with no Ratings array and absent fields to all-undefined ratings", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ Response: "True" })));
    const service = new OMDBService("test-key", mock.fetchImpl);

    const ratings = await service.fetchRatings("tt1234567");

    expect(ratings.imdbRating).toBeUndefined();
    expect(ratings.rtPercent).toBeUndefined();
    expect(ratings.metascore).toBeUndefined();
  });

  // MARK: - RT pulled from Ratings array (rottenTomatoesParsedFromRatingsArray)

  it("pulls the Rotten Tomatoes percent from the Ratings array even with other sources present", async () => {
    const body = JSON.stringify({
      imdbRating: "7.6",
      Metascore: "N/A",
      Ratings: [
        { Source: "Internet Movie Database", Value: "7.6/10" },
        { Source: "Rotten Tomatoes", Value: "91%" },
        { Source: "Metacritic", Value: "65/100" },
      ],
      Response: "True",
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new OMDBService("test-key", mock.fetchImpl);

    const ratings = await service.fetchRatings("tt7654321");

    expect(ratings.imdbRating).toBe(7.6);
    expect(ratings.rtPercent).toBe(91);
    expect(ratings.metascore).toBeUndefined();
  });

  // MARK: - Response:False (responseFalseThrowsNotFound)

  it("throws a notFound error for a Response:False body, carrying the OMDB Error message", async () => {
    const body = JSON.stringify({
      Response: "False",
      Error: "Incorrect IMDb ID.",
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new OMDBService("test-key", mock.fetchImpl);

    await expect(service.fetchRatings("ttbogus")).rejects.toMatchObject({
      kind: "notFound",
      detail: "Incorrect IMDb ID.",
    });
  });

  // MARK: - Non-2xx HTTP status (httpErrorStatusThrows)

  it("throws an httpError for a non-2xx HTTP status", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "{}" }));
    const service = new OMDBService("test-key", mock.fetchImpl);

    await expect(service.fetchRatings("tt0111161")).rejects.toMatchObject({
      kind: "httpError",
      statusCode: 503,
    });
  });
});
