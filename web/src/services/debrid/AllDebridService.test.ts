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

// MARK: - addMagnet

describe("AllDebridService addMagnet", () => {
  it("uploads a btih magnet and returns the first magnet id as a string", async () => {
    let uploadReq: CapturedRequest | undefined;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/v4/magnet/upload") {
        uploadReq = req;
        return ok(JSON.stringify({ data: { magnets: [{ id: 987654321, hash: "abc" }] } }));
      }
      return { status: 404, body: "{}" };
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const id = await service.addMagnet("DEADBEEF");

    expect(id).toBe("987654321");
    // POST with form body carrying the percent-encoded magnet + apikey component.
    expect(uploadReq?.method).toBe("POST");
    expect(uploadReq?.body).toContain("magnets[]=");
    expect(uploadReq?.body).toContain(encodeURIComponent("magnet:?xt=urn:btih:DEADBEEF"));
    expect(uploadReq?.body).toContain("apikey=ad-token");
    expect(uploadReq?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("coerces a numeric-string id via int64Value", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: [{ id: "42" }] } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    expect(await service.addMagnet("hash")).toBe("42");
  });

  it("throws downloadFailed when no magnets are returned", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ data: { magnets: [] } })));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.addMagnet("hash")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws downloadFailed when the first magnet has no coercible id", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: [{ id: "not-a-number", hash: "x" }] } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.addMagnet("hash")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws downloadFailed on an empty/malformed body", async () => {
    const mock = makeMockFetch(() => ok(""));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.addMagnet("hash")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });
});

// MARK: - getStreamURL link selection

describe("AllDebridService getStreamURL link selection", () => {
  it("skips the sample and selects the real video file", async () => {
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status":
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [
                    // Larger but sample → must be rejected.
                    { link: "https://ad.example/s.mkv", filename: "Movie.sample.mkv", size: 9_000_000_000 },
                    { link: "https://ad.example/m.mkv", filename: "Movie.2026.1080p.mkv", size: 4_000_000_000 },
                  ],
                },
              },
            }),
          );
        case "/v4/link/unlock":
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/m.mkv" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const stream = await service.getStreamURL("id1");
    expect(stream.fileName).toBe("Movie.2026.1080p.mkv");
    expect(stream.streamURL).toBe("https://ad.example/direct/m.mkv");
  });

  it("ignores link entries whose link is not a string", async () => {
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status":
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [
                    { link: 12345, filename: "bogus.mkv", size: 1 }, // non-string link skipped
                    { link: "https://ad.example/real.mkv", filename: "Real.1080p.mkv", size: 100 },
                  ],
                },
              },
            }),
          );
        case "/v4/link/unlock":
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/real.mkv" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const stream = await service.getStreamURL("id2");
    expect(stream.fileName).toBe("Real.1080p.mkv");
  });

  it("defaults filename to Unknown and size to 0 for sparse link entries", async () => {
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status":
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [{ link: "https://ad.example/file" }], // no filename, no size
                },
              },
            }),
          );
        case "/v4/link/unlock":
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/file" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const stream = await service.getStreamURL("id3");
    // normalizedName falls back to the link's last path component for the field
    // value; but selected.fileName is the raw "Unknown" default here.
    expect(stream.fileName).toBe("Unknown");
    expect(stream.sizeBytes).toBe(0);
    expect(stream.streamURL).toBe("https://ad.example/direct/file");
  });

  it("throws noFilesAvailable when every link entry lacks a usable link", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: { magnets: { status: "Ready", links: [{ filename: "x.mkv", size: 1 }] } },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.getStreamURL("id4")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
  });
});

// MARK: - getStreamURL polling

describe("AllDebridService getStreamURL polling", () => {
  it("polls until Ready, sleeping between attempts", async () => {
    const statuses = ["Downloading", "Downloading", "Ready"];
    let call = 0;
    const sleeps: number[] = [];
    const mock = makeMockFetch((req) => {
      switch (req.url.pathname) {
        case "/v4/magnet/status": {
          const status = statuses[Math.min(call, statuses.length - 1)];
          call++;
          if (status !== "Ready") {
            return ok(JSON.stringify({ data: { magnets: { status } } }));
          }
          return ok(
            JSON.stringify({
              data: {
                magnets: {
                  status: "Ready",
                  links: [{ link: "https://ad.example/r.mkv", filename: "R.1080p.mkv", size: 10 }],
                },
              },
            }),
          );
        }
        case "/v4/link/unlock":
          return ok(JSON.stringify({ data: { link: "https://ad.example/direct/r.mkv" } }));
        default:
          return { status: 404, body: "{}" };
      }
    });
    const service = new AllDebridService(
      "ad-token",
      mock.fetchImpl,
      async (ms) => {
        sleeps.push(ms);
      },
    );
    const stream = await service.getStreamURL("poll");
    expect(stream.streamURL).toBe("https://ad.example/direct/r.mkv");
    expect(call).toBe(3); // two non-ready + one ready
    expect(sleeps).toEqual([1000, 1000]); // slept after each non-ready attempt
  });

  it("treats any status containing 'error' as a terminal failure", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: { status: "Upload Error - file corrupt" } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.getStreamURL("bad")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws downloadFailed after exhausting all attempts without Ready", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: { status: "Downloading" } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await service.getStreamURL("stuck");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("downloadFailed");
    expect(caught?.message).toContain("not ready after 20s");
  });
});

// MARK: - unrestrict

describe("AllDebridService unrestrict", () => {
  it("returns the direct link and posts an encoded form body", async () => {
    let unlockReq: CapturedRequest | undefined;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/v4/link/unlock") {
        unlockReq = req;
        return ok(JSON.stringify({ data: { link: "https://cdn.example/file.mkv" } }));
      }
      return { status: 404, body: "{}" };
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const direct = await service.unrestrict("https://ad.example/hosted?a=b&c=d");

    expect(direct).toBe("https://cdn.example/file.mkv");
    expect(unlockReq?.method).toBe("POST");
    expect(unlockReq?.body).toContain("link=");
    // & inside the link value must stay percent-encoded so it isn't read as a
    // form delimiter.
    expect(unlockReq?.body).toContain(encodeURIComponent("https://ad.example/hosted?a=b&c=d"));
    expect(unlockReq?.body).toContain("apikey=ad-token");
  });

  it("throws downloadFailed when the unlocked link is missing", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ data: {} })));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.unrestrict("https://ad.example/x")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws downloadFailed when the unlocked link is not an absolute URL", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { link: "not-a-url" } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.unrestrict("https://ad.example/x")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });
});

// MARK: - listTorrents

describe("AllDebridService listTorrents", () => {
  it("normalizes magnets into DebridTorrent rows", async () => {
    const mock = makeMockFetch((req) => {
      // listTorrents calls /magnet/status with NO id query param.
      expect(req.url.searchParams.has("id")).toBe(false);
      return ok(
        JSON.stringify({
          data: {
            magnets: [
              {
                id: 111,
                filename: "Big.Buck.Bunny.1080p.mkv",
                hash: "ABCDEF",
                status: "Ready",
                size: 123456789,
                uploadDate: 1_700_000_000,
              },
            ],
          },
        }),
      );
    });
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const torrents = await service.listTorrents();

    expect(torrents).toHaveLength(1);
    expect(torrents[0]).toEqual({
      id: "111",
      name: "Big.Buck.Bunny.1080p.mkv",
      sizeBytes: 123456789,
      status: "Ready",
      infoHash: "abcdef", // lowercased
      addedAt: new Date(1_700_000_000 * 1000).toISOString(),
      host: null,
      progress: null,
      debridService: "AD",
    });
  });

  it("applies defaults for missing/malformed fields", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            magnets: [
              // No filename, no hash, no status, no size, uploadDate 0.
              { id: 7, uploadDate: 0 },
            ],
          },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const [t] = await service.listTorrents();
    expect(t.id).toBe("7");
    expect(t.name).toBe("Unknown");
    expect(t.infoHash).toBeNull();
    expect(t.status).toBe("unknown");
    expect(t.sizeBytes).toBe(0);
    expect(t.addedAt).toBeNull(); // uploadDate 0 is not > 0
  });

  it("falls back to a string id when id is not numeric", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: [{ id: "abc-123" }] } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const [t] = await service.listTorrents();
    // int64Value("abc-123") is null → falls back to String(m.id).
    expect(t.id).toBe("abc-123");
  });

  it("returns an empty list when magnets is missing or body is malformed", async () => {
    const missing = makeMockFetch(() => ok(JSON.stringify({ data: {} })));
    const svc1 = new AllDebridService("ad-token", missing.fetchImpl);
    expect(await svc1.listTorrents()).toEqual([]);

    const garbage = makeMockFetch(() => ok("not json"));
    const svc2 = new AllDebridService("ad-token", garbage.fetchImpl);
    expect(await svc2.listTorrents()).toEqual([]);
  });

  it("returns an empty list when magnets is an object (single-magnet shape), not an array", async () => {
    // /magnet/status with an id returns a single object; without id it returns an
    // array. listTorrents only handles the array case → object yields [].
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { magnets: { id: 1, status: "Ready" } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    expect(await service.listTorrents()).toEqual([]);
  });
});

// MARK: - deleteTorrent

describe("AllDebridService deleteTorrent", () => {
  it("issues GET /magnet/delete with the id query param", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ status: "success" })));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await service.deleteTorrent("555");

    const req = mock.byPath("/v4/magnet/delete");
    expect(req).toBeDefined();
    expect(req?.method).toBe("GET");
    expect(req?.url.searchParams.get("id")).toBe("555");
  });

  it("propagates an HTTP error from the delete endpoint", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "nope" }));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.deleteTorrent("1")).rejects.toMatchObject({
      kind: "httpError",
    });
  });
});

// MARK: - getAccountInfo edge cases

describe("AllDebridService getAccountInfo edge cases", () => {
  it("ignores a non-numeric premiumUntil and leaves expiry null", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: { user: { username: "u", isPremium: true, premiumUntil: "1700000000" } },
        }),
      ),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const info = await service.getAccountInfo();
    expect(info.premiumExpiry).toBeNull();
  });

  it("falls back to Unknown username and treats truthy non-true isPremium as not premium", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { user: { isPremium: 1 } } })),
    );
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    const info = await service.getAccountInfo();
    expect(info.username).toBe("Unknown");
    expect(info.isPremium).toBe(false); // strict === true required
  });

  it("throws invalidToken on an empty/malformed body", async () => {
    const mock = makeMockFetch(() => ok(""));
    const service = new AllDebridService("ad-token", mock.fetchImpl);
    await expect(service.getAccountInfo()).rejects.toMatchObject({
      kind: "invalidToken",
    });
  });
});

// MARK: - request plumbing

describe("AllDebridService request plumbing", () => {
  it("always sends agent + bearer/x-api-key auth and never the apikey in the query", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ data: { user: { username: "u" } } })),
    );
    const service = new AllDebridService("secret-token", mock.fetchImpl);
    await service.getAccountInfo();

    const req = mock.byPath("/v4/user");
    expect(req?.url.searchParams.get("agent")).toBe("DebridStreamer");
    expect(req?.headers["Authorization"]).toBe("Bearer secret-token");
    expect(req?.headers["X-API-Key"]).toBe("secret-token");
    // GET (no body) → no apikey form component anywhere in the URL.
    expect(req?.url.search).not.toContain("apikey");
    expect(req?.body).toBe("");
  });
});
