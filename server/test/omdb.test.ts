import { describe, expect, it } from "vitest";
import { fetchOmdbRatings, fetchOmdbViaBroker, isEmptyRatings, parseOmdbRatings } from "../src/omdb.js";

describe("parseOmdbRatings", () => {
  it("parses imdb / RT / metascore from a full response", () => {
    const r = parseOmdbRatings({
      imdbRating: "8.4",
      Metascore: "74",
      Ratings: [
        { Source: "Internet Movie Database", Value: "8.4/10" },
        { Source: "Rotten Tomatoes", Value: "87%" },
        { Source: "Metacritic", Value: "74/100" },
      ],
    });
    expect(r).toEqual({ imdbRating: 8.4, rtPercent: 87, metascore: 74 });
  });

  it("treats N/A and garbage as missing", () => {
    const r = parseOmdbRatings({ imdbRating: "N/A", Metascore: "8x", Ratings: [] });
    expect(r.imdbRating).toBeUndefined();
    expect(r.metascore).toBeUndefined();
    expect(r.rtPercent).toBeUndefined();
    expect(isEmptyRatings(r)).toBe(true);
  });

  it("clamps a Rotten Tomatoes percent into 0..100", () => {
    expect(parseOmdbRatings({ Ratings: [{ Source: "Rotten Tomatoes", Value: "150%" }] }).rtPercent).toBe(100);
  });
});

describe("fetchOmdbRatings", () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response);

  it("rejects a malformed imdb id without making a request", async () => {
    let called = false;
    const r = await fetchOmdbRatings("KEY", "not-an-id", (() => {
      called = true;
      return ok({});
    }) as unknown as typeof fetch);
    expect(r).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null for an empty key", async () => {
    expect(await fetchOmdbRatings("", "tt1375666")).toBeNull();
  });

  it("returns ratings for a valid lookup", async () => {
    const r = await fetchOmdbRatings(
      "KEY",
      "tt1375666",
      (() => ok({ imdbRating: "8.8", Ratings: [{ Source: "Rotten Tomatoes", Value: "87%" }] })) as unknown as typeof fetch,
    );
    expect(r).toEqual({ imdbRating: 8.8, rtPercent: 87 });
  });

  it("maps an OMDb Response:False to null", async () => {
    const r = await fetchOmdbRatings(
      "KEY",
      "tt0000000",
      (() => ok({ Response: "False", Error: "Incorrect IMDb ID." })) as unknown as typeof fetch,
    );
    expect(r).toBeNull();
  });

  it("returns null on a non-2xx status", async () => {
    const r = await fetchOmdbRatings(
      "KEY",
      "tt1375666",
      (() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch,
    );
    expect(r).toBeNull();
  });
});

describe("fetchOmdbViaBroker (consumer holds no key, only a token)", () => {
  it("forwards to the broker with a bearer token and returns its ratings", async () => {
    let sawAuth = "";
    let sawUrl = "";
    const r = await fetchOmdbViaBroker(
      "https://broker.example",
      "tok-123",
      "tt1375666",
      ((url: string, init: { headers?: Record<string, string> }) => {
        sawUrl = url;
        sawAuth = init?.headers?.authorization ?? "";
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ratings: { imdbRating: 8.8 } }),
        } as unknown as Response);
      }) as unknown as typeof fetch,
    );
    expect(r).toEqual({ imdbRating: 8.8 });
    expect(sawUrl).toBe("https://broker.example/api/broker/omdb/tt1375666");
    expect(sawAuth).toBe("Bearer tok-123");
  });

  it("returns null on a broker 401 and never sends the key", async () => {
    const r = await fetchOmdbViaBroker(
      "https://broker.example",
      "bad",
      "tt1375666",
      (() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch,
    );
    expect(r).toBeNull();
  });

  it("rejects a malformed imdb id without a request", async () => {
    let called = false;
    const r = await fetchOmdbViaBroker("https://broker.example", "t", "bad", (() => {
      called = true;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    }) as unknown as typeof fetch);
    expect(r).toBeNull();
    expect(called).toBe(false);
  });
});
