// Mirrors Tests/.../Services/Debrid/PremiumizeServiceTests.swift.

import { describe, expect, it } from "vitest";
import { PremiumizeService } from "./PremiumizeService";
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

describe("PremiumizeService getStreamURL", () => {
  it("parses metadata and uses the direct link as the stream URL", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/api/transfer/directdl") {
        return ok(
          JSON.stringify({
            content: [
              { link: "https://pm.example/sample.mkv", path: "Movie/sample.mkv", size: 500000 },
              {
                link: "https://pm.example/movie.mkv",
                path: "Movie/Movie.2026.1080p.BluRay.x264.mkv",
                size: 4000000000,
              },
            ],
          }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const stream = await service.getStreamURL("transfer123");

    // Premiumize streams the directdl link verbatim (no separate unrestrict).
    expect(stream.streamURL).toBe("https://pm.example/movie.mkv");
    // fileName is the lastPathComponent of the selected path.
    expect(stream.fileName).toBe("Movie.2026.1080p.BluRay.x264.mkv");
    expect(stream.quality).toBe("1080p");
    expect(stream.codec).toBe("H.264");
    expect(stream.source).toBe("BluRay");
    expect(stream.sizeBytes).toBe(4_000_000_000);
    expect(stream.debridService).toBe("PM");
  });

  it("throws noFilesAvailable when content has no playable link", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ content: [{ path: "file.mkv", size: 1234 }] })),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);

    await expect(service.getStreamURL("nolink")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
  });

  it("sends src_id without leaking credentials in the query", async () => {
    let directBody = "";
    let directQuery = "";
    const mock = makeMockFetch((req) => {
      directBody = req.body;
      directQuery = req.url.search;
      return ok(
        JSON.stringify({
          content: [{ link: "https://pm.example/f.mkv", path: "f.mkv", size: 10 }],
        }),
      );
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await service.getStreamURL("transfer123");

    expect(directBody).toContain("src_id=transfer123");
    expect(directQuery.includes("apikey=")).toBe(false);
  });
});

// MARK: - checkCache

describe("PremiumizeService checkCache", () => {
  it("maps response flags to cached/notCached with filename and size", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          response: [true, false],
          filename: ["Cached.Movie.mkv", null],
          filesize: [123456789, null],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHCACHED", "HASHMISS"]);

    expect(result.hashcached).toEqual({
      kind: "cached",
      fileId: null,
      fileName: "Cached.Movie.mkv",
      fileSize: 123_456_789,
    });
    expect(result.hashmiss).toEqual({ kind: "notCached" });
  });

  it("short-circuits to empty for empty input without hitting network", async () => {
    let didCallNetwork = false;
    const mock = makeMockFetch(() => {
      didCallNetwork = true;
      return ok("{}");
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache([]);

    expect(Object.keys(result).length).toBe(0);
    expect(didCallNetwork).toBe(false);
  });
});

// MARK: - getAccountInfo

describe("PremiumizeService getAccountInfo", () => {
  it("treats a present premium_until as premium", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ customer_id: "pm-user", premium_until: 1700000000 })),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const info = await service.getAccountInfo();

    expect(info.username).toBe("pm-user");
    expect(info.email).toBeNull();
    expect(info.isPremium).toBe(true);
    expect(info.premiumExpiry).toEqual(new Date(1_700_000_000 * 1000));
  });

  it("treats a missing premium_until as non-premium", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ customer_id: "free-user" })),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const info = await service.getAccountInfo();

    expect(info.username).toBe("free-user");
    expect(info.isPremium).toBe(false);
    expect(info.premiumExpiry).toBeNull();
  });

  it("maps HTTP 401 to invalidToken", async () => {
    const mock = makeMockFetch(() => ({
      status: 401,
      body: '{"error":"unauthorized"}',
    }));
    const service = new PremiumizeService("bad-token", mock.fetchImpl);
    await expect(service.getAccountInfo()).rejects.toMatchObject({
      kind: "invalidToken",
    });
  });

  it("maps a non-401 HTTP error to httpError", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "down" }));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);

    let caught: DebridError | null = null;
    try {
      await service.getAccountInfo();
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.equals(DebridError.httpError(503, "down"))).toBe(true);
  });
});

// MARK: - unrestrict

describe("PremiumizeService unrestrict", () => {
  it("returns the link verbatim", async () => {
    const service = new PremiumizeService("pm-token", makeMockFetch(() => ok("{}")).fetchImpl);
    const url = await service.unrestrict("https://pm.example/direct/file.mkv");
    expect(url).toBe("https://pm.example/direct/file.mkv");
  });
});

// MARK: - validateToken

describe("PremiumizeService validateToken", () => {
  it("returns true for a healthy account and false on 401", async () => {
    const okMock = makeMockFetch(() =>
      ok(JSON.stringify({ customer_id: "ok", premium_until: 1700000000 })),
    );
    const okService = new PremiumizeService("good", okMock.fetchImpl);
    expect(await okService.validateToken()).toBe(true);

    const badMock = makeMockFetch(() => ({ status: 401, body: "{}" }));
    const badService = new PremiumizeService("bad", badMock.fetchImpl);
    expect(await badService.validateToken()).toBe(false);
  });
});

// MARK: - serviceType

describe("PremiumizeService serviceType", () => {
  it("is premiumize", () => {
    const service = new PremiumizeService("pm-token", makeMockFetch(() => ok("{}")).fetchImpl);
    expect(service.serviceType).toBe("premiumize");
  });
});
