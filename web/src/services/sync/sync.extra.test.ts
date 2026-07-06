// Extra coverage for the sync layer's pure decoders + value types that the
// service-level suites leave uncovered:
//   - sync/types.ts: TraktSyncError.invalidResponse, the asObject non-object
//     guard, requireNumber's missing/mismatched-type throw, and
//     decodeWatchlistItems' non-array guard (all surface `decodingFailed`,
//     except invalidResponse which is its own kind).
//   - sync/models.ts: SyncState constants and the ListType.supportsFolders /
//     allCases helpers.
//   - IMDbCSVSyncService.parseCSV: the RFC-4180 escaped-quote ("") branch and
//     CRLF row terminators, exercised through the public parseCSV.

import { describe, expect, it } from "vitest";
import { IMDbCSVSyncService } from "./IMDbCSVSyncService";
import { ListType, SyncState } from "./models";
import {
  decodeDeviceCodeResponse,
  decodeTokenResponse,
  decodeWatchlistItems,
  decodeWatchlistPushResult,
  TraktSyncError,
} from "./types";

describe("TraktSyncError static constructors", () => {
  it("invalidURL carries the invalidURL kind and a human message", () => {
    const err = TraktSyncError.invalidURL();
    expect(err).toBeInstanceOf(TraktSyncError);
    expect(err.kind).toBe("invalidURL");
    expect(err.name).toBe("TraktSyncError");
    expect(err.message).toContain("Invalid Trakt URL");
  });

  it("invalidResponse carries the invalidResponse kind and message", () => {
    const err = TraktSyncError.invalidResponse();
    expect(err.kind).toBe("invalidResponse");
    expect(err.message).toContain("Invalid Trakt response");
    expect(err.statusCode).toBeUndefined();
  });

  it("httpStatus carries the status code and body", () => {
    const err = TraktSyncError.httpStatus(503, "down");
    expect(err.kind).toBe("httpStatus");
    expect(err.statusCode).toBe(503);
    expect(err.body).toBe("down");
    expect(err.message).toBe("Trakt HTTP 503: down");
  });

  it("decodingFailed carries the detail", () => {
    const err = TraktSyncError.decodingFailed("missing key");
    expect(err.kind).toBe("decodingFailed");
    expect(err.detail).toBe("missing key");
    expect(err.message).toContain("missing key");
  });
});

describe("sync/types decoders — failure branches", () => {
  it("asObject rejects a non-object (array) with decodingFailed", () => {
    expect(() => decodeDeviceCodeResponse([])).toThrowError(TraktSyncError);
    try {
      decodeDeviceCodeResponse([]);
    } catch (e) {
      expect((e as TraktSyncError).kind).toBe("decodingFailed");
    }
  });

  it("asObject rejects null with decodingFailed", () => {
    expect(() => decodeTokenResponse(null)).toThrowError(TraktSyncError);
  });

  it("asObject rejects a primitive with decodingFailed", () => {
    expect(() => decodeDeviceCodeResponse("nope")).toThrowError(TraktSyncError);
  });

  it("requireString throws decodingFailed when a required string is missing", () => {
    try {
      decodeDeviceCodeResponse({ user_code: "u" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TraktSyncError).kind).toBe("decodingFailed");
      expect((e as TraktSyncError).detail).toContain("device_code");
    }
  });

  it("requireNumber throws decodingFailed when a required number is the wrong type", () => {
    // All strings present but expires_in is a string -> requireNumber throws.
    const raw = {
      device_code: "d",
      user_code: "u",
      verification_url: "https://trakt.tv/activate",
      expires_in: "600",
      interval: 5,
    };
    try {
      decodeDeviceCodeResponse(raw);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TraktSyncError).kind).toBe("decodingFailed");
      expect((e as TraktSyncError).detail).toContain("expires_in");
    }
  });

  it("decodeDeviceCodeResponse maps a fully-valid body", () => {
    const out = decodeDeviceCodeResponse({
      device_code: "d",
      user_code: "u",
      verification_url: "https://trakt.tv/activate",
      expires_in: 600,
      interval: 5,
    });
    expect(out).toEqual({
      deviceCode: "d",
      userCode: "u",
      verificationURL: "https://trakt.tv/activate",
      expiresIn: 600,
      interval: 5,
    });
  });

  it("decodeWatchlistItems throws decodingFailed for a non-array body", () => {
    try {
      decodeWatchlistItems({ not: "an array" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TraktSyncError).kind).toBe("decodingFailed");
      expect((e as TraktSyncError).detail).toContain("array");
    }
  });

  it("decodeWatchlistItems drops entries lacking a movie or an imdb id", () => {
    const out = decodeWatchlistItems([
      { movie: null },
      { movie: { title: "No IDs", year: 2000, ids: {} } },
      { movie: { title: "Has IMDb", year: 2001, ids: { imdb: "tt5" } } },
      {}, // no movie key at all
    ]);
    expect(out).toEqual([{ imdbID: "tt5", title: "Has IMDb", year: 2001 }]);
  });

  it("decodeWatchlistItems defaults a missing year to null", () => {
    const out = decodeWatchlistItems([
      { movie: { title: "Yearless", ids: { imdb: "tt7" } } },
    ]);
    expect(out).toEqual([{ imdbID: "tt7", title: "Yearless", year: null }]);
  });

  it("decodeWatchlistPushResult defaults absent sections to null", () => {
    expect(decodeWatchlistPushResult({})).toEqual({
      added: null,
      existing: null,
      notFound: null,
    });
  });

  it("decodeWatchlistPushResult maps present counts and not_found ids", () => {
    const out = decodeWatchlistPushResult({
      added: { movies: 2 },
      existing: {},
      not_found: { movies: [{ ids: { imdb: "tt9" } }, { ids: null }, {}] },
    });
    expect(out).toEqual({
      added: { movies: 2 },
      existing: { movies: null },
      notFound: {
        movies: [{ ids: { imdb: "tt9" } }, { ids: null }, { ids: null }],
      },
    });
  });

  it("decodeWatchlistPushResult preserves a null imdb id as null", () => {
    const out = decodeWatchlistPushResult({
      not_found: { movies: [{ ids: { imdb: null } }] },
    });
    expect(out).toEqual({
      added: null,
      existing: null,
      notFound: {
        movies: [{ ids: { imdb: null } }],
      },
    });
  });

  it("defaults not_found.movies to null when the server omits the array", () => {
    const out = decodeWatchlistPushResult({
      not_found: {},
    });
    expect(out).toEqual({
      added: null,
      existing: null,
      notFound: {
        movies: null,
      },
    });
  });
});

describe("sync/models value types", () => {
  it("exposes the four SyncState constants", () => {
    expect(SyncState.idle).toBe("idle");
    expect(SyncState.running).toBe("running");
    expect(SyncState.success).toBe("success");
    expect(SyncState.failed).toBe("failed");
  });

  it("ListType.supportsFolders is false only for watchlist", () => {
    expect(ListType.supportsFolders("watchlist")).toBe(false);
    expect(ListType.supportsFolders("favorites")).toBe(true);
    expect(ListType.supportsFolders("custom")).toBe(true);
  });

  it("ListType constants + allCases enumerate every list kind", () => {
    expect(ListType.watchlist).toBe("watchlist");
    expect(ListType.favorites).toBe("favorites");
    expect(ListType.custom).toBe("custom");
    expect(ListType.allCases()).toEqual(["watchlist", "favorites", "custom"]);
  });
});

describe("IMDbCSVSyncService.parseCSV — RFC-4180 edge cases", () => {
  it("unescapes a doubled quote inside a quoted cell", () => {
    const service = new IMDbCSVSyncService();
    // A title with an embedded literal quote: 6"7 Movie -> stored as "6""7 Movie".
    const csv = 'Const,Title,Year\ntt1,"6""7 Movie",2020';
    const entries = service.parseCSV(csv, "favorites");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('6"7 Movie');
    expect(entries[0].imdbID).toBe("tt1");
    expect(entries[0].year).toBe(2020);
  });

  it("keeps a comma inside a quoted cell as part of the title", () => {
    const service = new IMDbCSVSyncService();
    const csv = 'Const,Title,Year\ntt2,"Hello, World",2001';
    const entries = service.parseCSV(csv, "favorites");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Hello, World");
  });

  it("parses CRLF-terminated rows (Windows line endings)", () => {
    const service = new IMDbCSVSyncService();
    const csv = "Const,Title,Year\r\ntt3,First,2010\r\ntt4,Second,2011\r\n";
    const entries = service.parseCSV(csv, "watchlist");
    expect(entries.map((e) => e.title)).toEqual(["First", "Second"]);
    expect(entries.map((e) => e.imdbID)).toEqual(["tt3", "tt4"]);
  });

  it("preserves a newline embedded inside a quoted cell", () => {
    const service = new IMDbCSVSyncService();
    const csv = 'Const,Title,Year\ntt5,"Line one\nLine two",2012';
    const entries = service.parseCSV(csv, "favorites");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Line one\nLine two");
  });

  it("drops a blank line between rows (the all-empty-row guard)", () => {
    const service = new IMDbCSVSyncService();
    // The blank middle line produces a single-empty-cell row that is dropped,
    // so only the two real data rows survive.
    const csv = "Const,Title,Year\ntt1,First,2010\n\ntt2,Second,2011";
    const entries = service.parseCSV(csv, "favorites");
    expect(entries.map((e) => e.title)).toEqual(["First", "Second"]);
  });

  it("drops a trailing all-empty row left by a final newline", () => {
    const service = new IMDbCSVSyncService();
    const csv = "Const,Title,Year\ntt1,Only,2010\n";
    const entries = service.parseCSV(csv, "favorites");
    expect(entries.map((e) => e.title)).toEqual(["Only"]);
  });

  it("flushes a final row that has no trailing newline", () => {
    const service = new IMDbCSVSyncService();
    // No trailing newline -> the post-loop flush (cell/row remaining) runs.
    const csv = "Const,Title,Year\ntt9,LastRow,2099";
    const entries = service.parseCSV(csv, "favorites");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ imdbID: "tt9", title: "LastRow", year: 2099 });
  });
});
