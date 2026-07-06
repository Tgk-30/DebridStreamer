import { describe, expect, it } from "vitest";
import {
  TraktSyncError,
  decodeDeviceCodeResponse,
  decodeTokenResponse,
  decodeWatchlistItems,
  decodeWatchlistPushResult,
} from "./types";

describe("TraktSyncError", () => {
  it("builds static error variants", () => {
    expect(TraktSyncError.invalidURL()).toMatchObject({
      kind: "invalidURL",
      message: "Invalid Trakt URL.",
    });
    expect(TraktSyncError.invalidResponse()).toMatchObject({
      kind: "invalidResponse",
      message: "Invalid Trakt response.",
    });
    expect(TraktSyncError.decodingFailed("bad json")).toMatchObject({
      kind: "decodingFailed",
      detail: "bad json",
    });
    expect(TraktSyncError.httpStatus(404, "nope")).toMatchObject({
      kind: "httpStatus",
      statusCode: 404,
      body: "nope",
      message: "Trakt HTTP 404: nope",
    });
  });
});

describe("decodeDeviceCodeResponse", () => {
  it("maps snake_case to camelCase and preserves fields", () => {
    const decoded = decodeDeviceCodeResponse({
      device_code: "d",
      user_code: "u",
      verification_url: "https://example.com",
      expires_in: 1200,
      interval: 10,
    });
    expect(decoded).toEqual({
      deviceCode: "d",
      userCode: "u",
      verificationURL: "https://example.com",
      expiresIn: 1200,
      interval: 10,
    });
  });

  it("throws decodingFailed for non-object payloads", () => {
    expect(() => decodeDeviceCodeResponse(7)).toThrow(/Expected object/);
  });

  it("throws decodingFailed when required fields are missing", () => {
    expect(() =>
      decodeDeviceCodeResponse({
        device_code: "d",
        user_code: "u",
        verification_url: "https://example.com",
        interval: 10,
      }),
    ).toThrow(/Missing number 'expires_in'/);
  });
});

describe("decodeTokenResponse", () => {
  it("maps token fields", () => {
    const decoded = decodeTokenResponse({
      access_token: "a",
      refresh_token: "r",
      expires_in: 1,
      token_type: "bearer",
      scope: "public",
      created_at: 123,
    });
    expect(decoded).toMatchObject({
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 1,
      tokenType: "bearer",
      scope: "public",
      createdAt: 123,
    });
  });
});

describe("decodeWatchlistItems", () => {
  it("extracts valid items and drops incomplete rows", () => {
    const items = decodeWatchlistItems([
      { movie: { title: "Movie 1", year: 2020, ids: { imdb: "tt1" } } },
      { movie: { title: "Movie 2", ids: {} } },
      { movie: null },
      {},
    ] as never);
    expect(items).toEqual([{ imdbID: "tt1", title: "Movie 1", year: 2020 }]);
  });

  it("rejects non-array payloads", () => {
    expect(() => decodeWatchlistItems({ movie: null })).toThrow(/Expected array/);
  });
});

describe("decodeWatchlistPushResult", () => {
  it("defaults absent buckets to null and maps present values", () => {
    const result = decodeWatchlistPushResult({});
    expect(result).toEqual({
      added: null,
      existing: null,
      notFound: null,
    });
  });

  it("maps present nested payload and preserves nulls", () => {
    const result = decodeWatchlistPushResult({
      added: { movies: 2 },
      existing: { movies: null },
      not_found: {
        movies: [{ ids: { imdb: "tt1" } }, { ids: { imdb: null } }, {}],
      },
    });
    expect(result).toMatchObject({
      added: { movies: 2 },
      existing: { movies: null },
      notFound: {
        movies: [
          { ids: { imdb: "tt1" } },
          { ids: { imdb: null } },
          { ids: null },
        ],
      },
    });
  });

  it("throws decodingFailed for non-object results", () => {
    expect(() => decodeWatchlistPushResult(null)).toThrow(/Expected object for TraktWatchlistPushResult/);
  });
});

