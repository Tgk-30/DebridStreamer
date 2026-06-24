// Mirrors Tests/.../Services/Debrid/AllDebridServiceTests.swift.
//
// A fetch stub plays the role of the Swift MockURLProtocol: it parses the
// requested URL, dispatches on pathname, and captures the request body so the
// unlock/cache assertions mirror the Swift `#expect` checks.

import { describe, expect, it } from "vitest";
import { AllDebridService } from "./AllDebridService";
import { DebridError, type FetchImpl } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeMockFetch(handler: (req: CapturedRequest) => MockResponse): {
  fetchImpl: FetchImpl;
  requests: CapturedRequest[];
  byPath: (path: string) => CapturedRequest | undefined;
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const captured: CapturedRequest = {
      url: new URL(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? "",
    };
    requests.push(captured);
    const { status, body } = handler(captured);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    requests,
    byPath: (path) => requests.find((r) => r.url.pathname === path),
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

// MARK: - getStreamURL

describe("AllDebridService getStreamURL", () => {
  it("parses quality/codec/source from the selected filename", async () => {
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status":
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [
                    { link: "https://ad.example/sample.mkv", filename: "Movie.2026.sample.mkv", size: 500000 },
                    { link: "https://ad.example/movie.mkv", filename: "Movie.2026.1080p.BluRay.x264.mkv", size: 4000000000 },
                  ],
                },
              },
            }),
          );
        case "/v4/link/unlock":
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/movie.mkv" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const stream = await service.getStreamURL("abc123");

    expect(stream.streamURL).toBe("https://ad.example/direct/movie.mkv");
    expect(stream.fileName).toBe("Movie.2026.1080p.BluRay.x264.mkv");
    expect(stream.quality).toBe("1080p");
    expect(stream.codec).toBe("H.264");
    expect(stream.source).toBe("BluRay");
    expect(stream.sizeBytes).toBe(4_000_000_000);
    expect(stream.debridService).toBe("AD");
  });

  it("unlocks the best link and uses its direct URL", async () => {
    let unlockBody = "";
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status":
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [
                    { link: "https://ad.example/best.mp4", filename: "Show.S01E01.720p.WEB-DL.x265.mp4", size: 1500000000 },
                  ],
                },
              },
            }),
          );
        case "/v4/link/unlock":
          unlockBody = req.body;
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/best.mp4" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const stream = await service.getStreamURL("xyz");

    expect(unlockBody).toContain("link=");
    expect(unlockBody).toContain("best.mp4");
    expect(stream.streamURL).toBe("https://ad.example/direct/best.mp4");
    expect(stream.codec).toBe("H.265");
    expect(stream.source).toBe("WEB-DL");
  });

  it("throws torrentNotFound when the status payload is malformed", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ data: {} })));
    const service = new AllDebridService("ad-token", mock.fetchImpl);

    let caught: DebridError | null = null;
    try {
      await service.getStreamURL("nope");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("torrentNotFound");
    expect(caught?.equals(DebridError.torrentNotFound("nope"))).toBe(true);
  });

  it("throws downloadFailed on a terminal Error status", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: { status: "Error", links: [] } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);

    await expect(service.getStreamURL("boom")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws noFilesAvailable when Ready but links are missing", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: { status: "Ready" } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);

    await expect(service.getStreamURL("empty")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
  });
});

// MARK: - checkCache

describe("AllDebridService checkCache", () => {
  it("maps instant flags to cached/notCached keyed by lowercased hash", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            magnets: [
              { hash: "ABCDEF", instant: true },
              { hash: "123456", instant: false },
            ],
          },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const result = await service.checkCache(["ABCDEF", "123456"]);

    expect(result.abcdef).toEqual({
      kind: "cached",
      fileId: null,
      fileName: null,
      fileSize: null,
    });
    expect(result["123456"]).toEqual({ kind: "notCached" });
  });

  it("short-circuits to empty for empty input without hitting network", async () => {
    let didCallNetwork = false;
    const mock = makeMockFetch(() => {
      didCallNetwork = true;
      return ok("{}");
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const result = await service.checkCache([]);

    expect(Object.keys(result).length).toBe(0);
    expect(didCallNetwork).toBe(false);
  });

  it("skips hash-less/error magnet rows instead of writing an empty-string key", async () => {
    // An invalid magnet entry has no `hash` field. The old code collapsed it to
    // "" and wrote results[""], dropping the real hash's status.
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            magnets: [
              { hash: "ABCDEF", instant: true },
              { error: { code: "MAGNET_INVALID_ID" } }, // no hash
              { hash: 12345, instant: true }, // non-string hash
            ],
          },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const result = await service.checkCache(["ABCDEF"]);

    expect(result.abcdef).toEqual({
      kind: "cached",
      fileId: null,
      fileName: null,
      fileSize: null,
    });
    // No bogus empty-string key; only the real hash is present.
    expect(Object.prototype.hasOwnProperty.call(result, "")).toBe(false);
    expect(Object.keys(result)).toEqual(["abcdef"]);
  });
});

// MARK: - getAccountInfo

describe("AllDebridService getAccountInfo", () => {
  it("decodes username, email, isPremium and premium expiry", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            user: {
              username: "ad-user",
              email: "ad@example.com",
              isPremium: true,
              premiumUntil: 1700000000,
            },
          },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const info = await service.getAccountInfo();

    expect(info.username).toBe("ad-user");
    expect(info.email).toBe("ad@example.com");
    expect(info.isPremium).toBe(true);
    expect(info.premiumExpiry).toEqual(new Date(1_700_000_000 * 1000));
  });

  it("decodes a non-premium account with defaults", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { user: { username: "free-user" } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const info = await service.getAccountInfo();

    expect(info.username).toBe("free-user");
    expect(info.email).toBeNull();
    expect(info.isPremium).toBe(false);
    expect(info.premiumExpiry).toBeNull();
  });

  it("throws invalidToken when the user object is missing", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ data: {} })));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.getAccountInfo()).rejects.toMatchObject({
      kind: "invalidToken",
    });
  });

  it("maps HTTP 401 to invalidToken", async () => {
    const mock = makeMockFetch(() => ({
      status: 401,
      body: '{"error":"unauthorized"}',
    }));
    const service = new AllDebridService("bad-token", mock.fetchImpl);
    await expect(service.getAccountInfo()).rejects.toMatchObject({
      kind: "invalidToken",
    });
  });

  it("maps a non-401 HTTP error to httpError", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "boom" }));
    const service = new AllDebridService("ad-token", mock.fetchImpl);

    let caught: DebridError | null = null;
    try {
      await service.getAccountInfo();
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.equals(DebridError.httpError(500, "boom"))).toBe(true);
  });
});

// MARK: - validateToken

describe("AllDebridService validateToken", () => {
  it("returns true for a healthy account and false on 401", async () => {
    const okMock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { user: { username: "ok", isPremium: true } } })),
    );
    const okService = new AllDebridService("good", okMock.fetchImpl);
    expect(await okService.validateToken()).toBe(true);

    const badMock = makeMockFetch(() => ({ status: 401, body: "{}" }));
    const badService = new AllDebridService("bad", badMock.fetchImpl);
    expect(await badService.validateToken()).toBe(false);
  });
});

// MARK: - serviceType

describe("AllDebridService serviceType", () => {
  it("is all_debrid", () => {
    const service = new AllDebridService("ad-token", makeMockFetch(() => ok("{}")).fetchImpl);
    expect(service.serviceType).toBe("all_debrid");
  });
});
