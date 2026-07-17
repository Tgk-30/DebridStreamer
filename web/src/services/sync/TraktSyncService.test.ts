// Mirrors Tests/DebridStreamerTests/Services/Sync/TraktSyncServiceTests.swift.
//
// The Swift tests stub the network with a MockURLProtocol whose handler is
// keyed per session and can branch on a step counter. Here we inject a
// `FetchImpl` stub that plays the same role: it captures the requested URL +
// init (method/headers/body) and supports a step-branching handler. The canned
// JSON bodies below are byte-for-byte the same shapes as the Swift test bodies.

import { describe, expect, it } from "vitest";
import { type FetchImpl, TraktSyncService } from "./TraktSyncService";

// MARK: - fetch stub (mirrors MockURLProtocol + makeMockSession)

interface MockResponse {
  status: number;
  body: string;
}

interface CapturedRequest {
  url: URL;
  method: string | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  last: () => CapturedRequest | null;
  hits: () => number;
}

/** Builds a fetch stub from a handler `(request, step) => MockResponse`, where
 * `step` is the 1-based call index (mirrors the Swift `step` counter). */
function makeMockFetch(
  handler: (req: CapturedRequest, step: number) => MockResponse,
): MockFetch {
  let count = 0;
  let captured: CapturedRequest | null = null;
  const fetchImpl: FetchImpl = async (url, init) => {
    count += 1;
    const req: CapturedRequest = {
      url: new URL(url),
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    };
    captured = req;
    const { status, body } = handler(req, count);
    return { status, text: async () => body };
  };
  return { fetchImpl, last: () => captured, hits: () => count };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

// MARK: - Device auth start + token exchange decode (deviceAuthFlowDecoding)

describe("TraktSyncService device auth flow", () => {
  it("decodes device code then token exchange correctly", async () => {
    const deviceBody = `
      {
        "device_code":"dev-code",
        "user_code":"ABCD-EFGH",
        "verification_url":"https://trakt.tv/activate",
        "expires_in":600,
        "interval":5
      }`;
    const tokenBody = `
      {
        "access_token":"access-token",
        "refresh_token":"refresh-token",
        "expires_in":7776000,
        "token_type":"bearer",
        "scope":"public",
        "created_at":1700000000
      }`;

    const mock = makeMockFetch((_req, step) =>
      step === 1 ? ok(deviceBody) : ok(tokenBody),
    );
    const service = new TraktSyncService(mock.fetchImpl);

    const device = await service.startDeviceAuth("client-id");
    expect(device.deviceCode).toBe("dev-code");
    expect(device.userCode).toBe("ABCD-EFGH");
    expect(device.verificationURL).toBe("https://trakt.tv/activate");
    expect(device.expiresIn).toBe(600);
    expect(device.interval).toBe(5);

    // Verify request shape of the device-code POST.
    const first = mock.last()!;
    expect(first.url.pathname).toBe("/oauth/device/code");
    expect(first.method).toBe("POST");
    expect(first.headers!["Content-Type"]).toBe("application/json");
    expect(first.headers!["trakt-api-version"]).toBe("2");
    expect(JSON.parse(first.body!)).toEqual({ client_id: "client-id" });

    const token = await service.exchangeDeviceCode(
      "client-id",
      "client-secret",
      "dev-code",
    );
    expect(token.accessToken).toBe("access-token");
    expect(token.refreshToken).toBe("refresh-token");
    expect(token.expiresIn).toBe(7776000);
    expect(token.createdAt).toBe(1700000000);

    const second = mock.last()!;
    expect(second.url.pathname).toBe("/oauth/device/token");
    expect(JSON.parse(second.body!)).toEqual({
      code: "dev-code",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });
});

// MARK: - refreshToken request shape (no direct Swift test, but covers the
// token-refresh path the prompt calls out)

describe("TraktSyncService refreshToken", () => {
  it("posts the refresh grant and decodes the new token", async () => {
    const tokenBody = JSON.stringify({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7776000,
      token_type: "bearer",
      scope: "public",
      created_at: 1700001000,
    });
    const mock = makeMockFetch(() => ok(tokenBody));
    const service = new TraktSyncService(mock.fetchImpl);

    const token = await service.refreshToken(
      "client-id",
      "client-secret",
      "old-refresh",
    );
    expect(token.accessToken).toBe("new-access");
    expect(token.refreshToken).toBe("new-refresh");

    const req = mock.last()!;
    expect(req.url.pathname).toBe("/oauth/token");
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toEqual({
      refresh_token: "old-refresh",
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "refresh_token",
    });
  });
});

// MARK: - Watchlist fetch decodes movie IDs (fetchWatchlistDecoding)

describe("TraktSyncService fetchWatchlist", () => {
  it("decodes movie ids and sets the auth headers", async () => {
    const body = `
      [
        {"movie":{"title":"Movie A","year":2024,"ids":{"imdb":"tt1111111"}}},
        {"movie":{"title":"Movie B","year":2025,"ids":{"imdb":"tt2222222"}}}
      ]`;
    const mock = makeMockFetch(() => ok(body));
    const service = new TraktSyncService(mock.fetchImpl);

    const items = await service.fetchWatchlist("client-id", "access-token");
    expect(items.length).toBe(2);
    expect(items[0].imdbID).toBe("tt1111111");
    expect(items[1].title).toBe("Movie B");
    expect(items[0].year).toBe(2024);

    const req = mock.last()!;
    expect(req.url.pathname).toBe("/sync/watchlist/movies");
    expect(req.method).toBe("GET");
    expect(req.headers!["trakt-api-key"]).toBe("client-id");
    expect(req.headers!.Authorization).toBe("Bearer access-token");
  });

  it("drops entries with no movie or no imdb id (compactMap semantics)", async () => {
    const body = JSON.stringify([
      { movie: { title: "Has ID", year: 2020, ids: { imdb: "tt0000001" } } },
      { movie: { title: "No IMDb", year: 2021, ids: {} } },
      { movie: null },
      {},
    ]);
    const mock = makeMockFetch(() => ok(body));
    const service = new TraktSyncService(mock.fetchImpl);

    const items = await service.fetchWatchlist("client-id", "access-token");
    expect(items.length).toBe(1);
    expect(items[0].imdbID).toBe("tt0000001");
  });
});

// MARK: - HTTP errors surface status and body (errorHandling)

describe("TraktSyncService error handling", () => {
  it("maps a non-2xx to httpStatus carrying the status and body", async () => {
    const mock = makeMockFetch(() => ({
      status: 401,
      body: '{"error":"invalid_grant"}',
    }));
    const service = new TraktSyncService(mock.fetchImpl);

    await expect(service.startDeviceAuth("client-id")).rejects.toMatchObject({
      kind: "httpStatus",
      statusCode: 401,
    });

    try {
      await service.startDeviceAuth("client-id");
    } catch (error) {
      expect((error as { body?: string }).body).toContain("invalid_grant");
    }
  });

  // decodeErrorSurfacesDecodingFailed: 200 OK with a structurally-wrong body
  // must surface decodingFailed (NOT invalidResponse), mirroring Swift's
  // JSONDecoder failure mapping.
  it("maps a valid-JSON-but-wrong-shape 200 body to decodingFailed", async () => {
    const mock = makeMockFetch(() => ok('{"unexpected":true}'));
    const service = new TraktSyncService(mock.fetchImpl);

    await expect(service.startDeviceAuth("client-id")).rejects.toMatchObject({
      kind: "decodingFailed",
    });

    try {
      await service.startDeviceAuth("client-id");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBeTruthy();
    }
  });

  it("maps non-JSON garbage to decodingFailed", async () => {
    const mock = makeMockFetch(() => ok("not json at all"));
    const service = new TraktSyncService(mock.fetchImpl);

    await expect(service.startDeviceAuth("client-id")).rejects.toMatchObject({
      kind: "decodingFailed",
    });
  });
});

describe("TraktSyncService request internals", () => {
  it("returns invalidURL when the base URL cannot form a request URL", async () => {
    let called = false;
    const fetchImpl: FetchImpl = async () => {
      called = true;
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            device_code: "dev-code",
            user_code: "ABCD-EFGH",
            verification_url: "https://trakt.tv/activate",
            expires_in: 600,
            interval: 5,
          }),
      };
    };
    const service = new TraktSyncService(fetchImpl);
    (service as unknown as { baseURL: string }).baseURL = ":::";

    await expect(service.startDeviceAuth("client-id")).rejects.toMatchObject({
      kind: "invalidURL",
    });
    expect(called).toBe(false);
  });
});

// MARK: - pushWatchlist decodes added/existing/not_found (pushWatchlistDecodesSummary)

describe("TraktSyncService pushWatchlist", () => {
  it("decodes the added/existing/not_found summary and posts the movie ids", async () => {
    const body = `
      {
        "added": {"movies": 1},
        "existing": {"movies": 0},
        "not_found": {"movies": [{"ids": {"imdb": "tt9999999"}}]}
      }`;
    const mock = makeMockFetch(() => ({ status: 201, body }));
    const service = new TraktSyncService(mock.fetchImpl);

    const result = await service.pushWatchlist("client-id", "access-token", [
      "tt1111111",
      "tt9999999",
    ]);
    expect(result.added?.movies).toBe(1);
    expect(result.existing?.movies).toBe(0);
    expect(result.notFound?.movies?.[0]?.ids?.imdb).toBe("tt9999999");

    const req = mock.last()!;
    expect(req.url.pathname).toBe("/sync/watchlist");
    expect(req.method).toBe("POST");
    expect(req.headers!["trakt-api-key"]).toBe("client-id");
    expect(req.headers!.Authorization).toBe("Bearer access-token");
    expect(JSON.parse(req.body!)).toEqual({
      movies: [{ ids: { imdb: "tt1111111" } }, { ids: { imdb: "tt9999999" } }],
    });
  });
});

// MARK: - isExpired math (isExpiredMath)

describe("TraktSyncService.isExpired", () => {
  it("accounts for created_at + expires_in and the buffer", () => {
    const createdAt = 1_700_000_000;
    const expiresIn = 7_776_000; // 90 days

    // Well before expiry, with no buffer, still valid.
    const early = createdAt + 1000;
    expect(
      TraktSyncService.isExpired(createdAt, expiresIn, early, 0),
    ).toBe(false);

    // Past the real expiry -> expired.
    const late = createdAt + expiresIn + 10;
    expect(TraktSyncService.isExpired(createdAt, expiresIn, late, 0)).toBe(true);

    // Within the buffer window before real expiry -> treat as expired.
    const justInsideBuffer = createdAt + expiresIn - 3600;
    expect(
      TraktSyncService.isExpired(
        createdAt,
        expiresIn,
        justInsideBuffer,
        24 * 60 * 60,
      ),
    ).toBe(true);
  });
});
