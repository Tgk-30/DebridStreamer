// Mirrors Tests/.../Services/Debrid/RealDebridServiceTests.swift.
//
// The Swift tests stub the network with a MockURLProtocol handler keyed per
// session, matching on the request path and capturing requests. Here we inject a
// `FetchImpl` stub that plays the same role: it parses the requested URL, hands
// it to a handler `(url, init) => MockResponse`, and records the last request so
// assertions on headers/body/query mirror the Swift `#require`/`#expect` checks.

import { describe, expect, it } from "vitest";
import { RealDebridService } from "./RealDebridService";
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

interface MockFetch {
  fetchImpl: FetchImpl;
  requests: CapturedRequest[];
  byPath: (path: string) => CapturedRequest | undefined;
  hits: () => number;
}

/** Builds a fetch stub from a handler `(req) => MockResponse`. */
function makeMockFetch(
  handler: (req: CapturedRequest) => MockResponse,
): MockFetch {
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
    hits: () => requests.length,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

// MARK: - getAccountInfo

describe("RealDebridService getAccountInfo", () => {
  it("decodes username, email, premium and ISO8601 expiration", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/user") {
        return ok(
          JSON.stringify({
            username: "rd-user",
            email: "rd@example.com",
            premium: 2592000,
            points: 1000,
            expiration: "2026-09-01T12:00:00Z",
          }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const info = await rd.getAccountInfo();

    expect(info.username).toBe("rd-user");
    expect(info.email).toBe("rd@example.com");
    expect(info.isPremium).toBe(true);
    expect(info.points).toBe(1000);
    expect(info.premiumExpiry).toEqual(new Date("2026-09-01T12:00:00Z"));

    // Token is sent as a Bearer header, never leaked into the query.
    const req = mock.byPath("/rest/1.0/user")!;
    expect(req.headers.Authorization).toBe("Bearer rd-token");
    expect(req.url.search.includes("token=")).toBe(false);
  });

  it("treats premium == 0 as not premium and tolerates missing fields", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ id: 1 })));
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const info = await rd.getAccountInfo();

    expect(info.username).toBe("Unknown");
    expect(info.email).toBeNull();
    expect(info.isPremium).toBe(false);
    expect(info.premiumExpiry).toBeNull();
    expect(info.points).toBeNull();
  });
});

// MARK: - HTTP status mapping

describe("RealDebridService HTTP status mapping", () => {
  async function expectAccountError(status: number): Promise<DebridError> {
    const mock = makeMockFetch(() => ({ status, body: "{}" }));
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    try {
      await rd.getAccountInfo();
      throw new Error("expected throw");
    } catch (e) {
      if (e instanceof DebridError) return e;
      throw e;
    }
  }

  it("maps HTTP 401 to invalidToken", async () => {
    expect((await expectAccountError(401)).kind).toBe("invalidToken");
  });

  it("maps HTTP 403 to expired", async () => {
    expect((await expectAccountError(403)).kind).toBe("expired");
  });

  it("maps HTTP 429 to rateLimited", async () => {
    expect((await expectAccountError(429)).kind).toBe("rateLimited");
  });

  it("maps HTTP 400 to httpError with status and body", async () => {
    const mock = makeMockFetch(() => ({
      status: 400,
      body: '{"error":"bad_token"}',
    }));
    const rd = new RealDebridService("rd-token", mock.fetchImpl);

    let caught: DebridError | null = null;
    try {
      await rd.getAccountInfo();
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.kind).toBe("httpError");
    expect(caught!.statusCode).toBe(400);
    expect(caught!.body).toContain("bad_token");
  });

  it("validateToken returns false when getAccountInfo throws", async () => {
    const mock = makeMockFetch(() => ({ status: 401, body: "{}" }));
    const rd = new RealDebridService("bad", mock.fetchImpl);
    expect(await rd.validateToken()).toBe(false);
  });

  it("validateToken returns true when account info resolves", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ username: "ok", premium: 1 })),
    );
    const rd = new RealDebridService("good", mock.fetchImpl);
    expect(await rd.validateToken()).toBe(true);
  });
});

// MARK: - findExistingTorrent

describe("RealDebridService findExistingTorrent", () => {
  it("requests the bounded list and returns id for a downloaded match (case-insensitive)", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        return ok(
          JSON.stringify([
            { id: "AAA", hash: "DEADBEEF", status: "downloaded" },
            { id: "BBB", hash: "CAFE0000", status: "magnet_conversion" },
          ]),
        );
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const id = await rd.findExistingTorrent("deadbeef");
    expect(id).toBe("AAA");

    const req = mock.byPath("/rest/1.0/torrents")!;
    expect(req.url.search).toContain("limit=100");
    expect(req.url.search).toContain("page=1");
  });

  it("returns in-progress id without deleting", async () => {
    let deleteCalled = false;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        return ok(
          JSON.stringify([{ id: "PROG", hash: "abc123", status: "downloading" }]),
        );
      }
      if (req.url.pathname.startsWith("/rest/1.0/torrents/delete/")) {
        deleteCalled = true;
        return { status: 204, body: "" };
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const id = await rd.findExistingTorrent("ABC123");
    expect(id).toBe("PROG");
    expect(deleteCalled).toBe(false);
  });

  it("deletes an error-state torrent and returns null", async () => {
    let deletedPath: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        return ok(
          JSON.stringify([{ id: "ERR1", hash: "ff00ff00", status: "error" }]),
        );
      }
      if (req.url.pathname.startsWith("/rest/1.0/torrents/delete/")) {
        deletedPath = req.url.pathname;
        return { status: 204, body: "" };
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const id = await rd.findExistingTorrent("FF00FF00");
    expect(id).toBeNull();
    expect(deletedPath).toBe("/rest/1.0/torrents/delete/ERR1");
  });

  it("returns null when no hash matches", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        return ok(
          JSON.stringify([{ id: "OTHER", hash: "11112222", status: "downloaded" }]),
        );
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.findExistingTorrent("deadbeef")).toBeNull();
  });
});

// MARK: - getStreamURL file-candidate pairing (downloaded -> no poll loop)

describe("RealDebridService getStreamURL", () => {
  it("pairs links to selected files by index and unrestricts the best", async () => {
    let unrestrictBody: string | null = null;
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({
            id: "T1",
            status: "downloaded",
            filename: "Movie.2026",
            links: [
              "https://rd.example/link-sample",
              "https://rd.example/link-movie",
            ],
            files: [
              { id: 7, path: "/Movie.2026.1080p.x264.mp4", bytes: 2500000000, selected: 1 },
              { id: 3, path: "/Movie.2026.sample.mkv", bytes: 50000000, selected: 1 },
              { id: 9, path: "/Movie.2026.nfo", bytes: 1000, selected: 0 },
            ],
          }),
        );
      }
      if (path === "/rest/1.0/unrestrict/link") {
        unrestrictBody = req.body;
        return ok(JSON.stringify({ download: "https://rd.example/direct/movie.mp4" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const stream = await rd.getStreamURL("T1");

    // The movie (selected file id 7, paired to links[1]) wins selection.
    expect(stream.streamURL).toBe("https://rd.example/direct/movie.mp4");
    expect(stream.fileName).toBe("Movie.2026.1080p.x264.mp4");
    expect(stream.quality).toBe("1080p");
    expect(stream.codec).toBe("H.264");
    expect(stream.sizeBytes).toBe(2_500_000_000);
    expect(stream.debridService).toBe("RD");

    // The link sent to unrestrict is the movie link (links[1]), not the sample.
    expect(unrestrictBody).not.toBeNull();
    expect(unrestrictBody!).toContain("link-movie");
    expect(unrestrictBody!).not.toContain("link-sample");
  });

  it("falls back to the top-level filename when no files are selected", async () => {
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({
            id: "T2",
            status: "downloaded",
            filename: "Solo.2026.1080p.mp4",
            bytes: 1500000000,
            links: ["https://rd.example/solo-link"],
          }),
        );
      }
      if (path === "/rest/1.0/unrestrict/link") {
        return ok(JSON.stringify({ download: "https://rd.example/direct/solo.mp4" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const stream = await rd.getStreamURL("T2");

    expect(stream.fileName).toBe("Solo.2026.1080p.mp4");
    expect(stream.sizeBytes).toBe(1_500_000_000);
    expect(stream.streamURL).toBe("https://rd.example/direct/solo.mp4");
  });

  it("throws noFilesAvailable when a downloaded torrent has no links", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({ id: "T3", status: "downloaded", filename: "X", links: [] }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.getStreamURL("T3");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("noFilesAvailable");
  });

  it("throws downloadFailed immediately on a terminal error status", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ id: "T4", status: "dead" })),
    );
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.getStreamURL("T4");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("downloadFailed");
    expect(caught?.detail).toContain("dead");
  });
});

// MARK: - unrestrict (single-shot parse)

describe("RealDebridService unrestrict", () => {
  it("parses the download URL and sends the encoded restricted link", async () => {
    let unrestrictBody: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        unrestrictBody = req.body;
        return ok(
          JSON.stringify({
            download: "https://rd.example/direct/file.mkv",
            filename: "file.mkv",
          }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const url = await rd.unrestrict("https://host.example/restricted/abc");

    expect(url).toBe("https://rd.example/direct/file.mkv");
    expect(unrestrictBody).not.toBeNull();
    expect(unrestrictBody!.startsWith("link=")).toBe(true);
    expect(unrestrictBody!).toContain("host.example");
  });
});

// MARK: - unrestrictDetailed (download + id for the transcode path)

describe("RealDebridService unrestrictDetailed", () => {
  it("returns the download URL and the unrestrict id", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        return ok(
          JSON.stringify({
            id: "ABCUNREST",
            download: "https://rd.example/direct/file.mkv",
            filename: "file.mkv",
          }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const res = await rd.unrestrictDetailed("https://host.example/restricted/abc");
    expect(res.download).toBe("https://rd.example/direct/file.mkv");
    expect(res.id).toBe("ABCUNREST");
  });

  it("tolerates a missing id (id null) while still returning download", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        return ok(JSON.stringify({ download: "https://rd.example/d/x.mkv" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const res = await rd.unrestrictDetailed("https://host.example/r/x");
    expect(res.download).toBe("https://rd.example/d/x.mkv");
    expect(res.id).toBeNull();
  });
});

// MARK: - getStreamURL surfaces restrictedId

describe("RealDebridService getStreamURL restrictedId", () => {
  it("carries the unrestrict id onto the StreamInfo for the transcode path", async () => {
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({
            id: "T9",
            status: "downloaded",
            filename: "Show.2026.2160p.x265.mkv",
            bytes: 8000000000,
            links: ["https://rd.example/show-link"],
          }),
        );
      }
      if (path === "/rest/1.0/unrestrict/link") {
        return ok(
          JSON.stringify({
            id: "UNREST9",
            download: "https://rd.example/direct/show.mkv",
          }),
        );
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const stream = await rd.getStreamURL("T9");
    expect(stream.streamURL).toBe("https://rd.example/direct/show.mkv");
    expect(stream.restrictedId).toBe("UNREST9");
    expect(stream.codec).toBe("H.265");
  });
});

// MARK: - getTranscodeHLS (MKV/HEVC -> in-webview HLS)

describe("RealDebridService getTranscodeHLS", () => {
  function transcodeMock(applyBody: unknown) {
    return makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/streaming/transcode/")) {
        return ok(JSON.stringify(applyBody));
      }
      return { status: 404, body: "{}" };
    });
  }

  it("prefers the 'full' apple (HLS) variant", async () => {
    const mock = transcodeMock({
      apple: {
        "480p": "https://rd.example/t/480.m3u8",
        "1080p": "https://rd.example/t/1080.m3u8",
        full: "https://rd.example/t/full.m3u8",
      },
      dash: { full: "https://rd.example/t/full.mpd" },
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const url = await rd.getTranscodeHLS("UNREST9");
    expect(url).toBe("https://rd.example/t/full.m3u8");
    // Hit the documented path.
    expect(mock.byPath("/rest/1.0/streaming/transcode/UNREST9")).toBeTruthy();
  });

  it("picks the highest resolution when there is no 'full'", async () => {
    const mock = transcodeMock({
      apple: {
        "480p": "https://rd.example/t/480.m3u8",
        "720p": "https://rd.example/t/720.m3u8",
        "1080p": "https://rd.example/t/1080.m3u8",
      },
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBe("https://rd.example/t/1080.m3u8");
  });

  it("ignores non-HLS formats (dash/liveMP4/h264WebM)", async () => {
    const mock = transcodeMock({
      dash: { full: "https://rd.example/t/full.mpd" },
      liveMP4: { full: "https://rd.example/t/full.mp4" },
      h264WebM: { full: "https://rd.example/t/full.webm" },
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBeNull();
  });

  it("falls back to any nested .m3u8 URL if 'apple' is absent", async () => {
    const mock = transcodeMock({
      hls: { full: "https://rd.example/t/alt.m3u8" },
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBe("https://rd.example/t/alt.m3u8");
  });

  it("tolerates m3u8 URLs that carry a query string", async () => {
    const mock = transcodeMock({
      apple: { full: "https://rd.example/t/full.m3u8?token=abc&exp=123" },
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBe(
      "https://rd.example/t/full.m3u8?token=abc&exp=123",
    );
  });

  it("returns null when the response has no usable URL", async () => {
    const mock = transcodeMock({ apple: {}, dash: {} });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBeNull();
  });

  it("returns null on an empty/garbage body rather than throwing", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/streaming/transcode/")) {
        return { status: 200, body: "" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getTranscodeHLS("X")).toBeNull();
  });
});

// MARK: - checkCache (RD disabled instantAvailability -> all unknown)

describe("RealDebridService checkCache", () => {
  it("returns unknown for every lowercased hash and makes no network call", async () => {
    const mock = makeMockFetch(() => {
      throw new Error("checkCache must not perform any network request");
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);

    const empty = await rd.checkCache([]);
    expect(Object.keys(empty).length).toBe(0);

    const result = await rd.checkCache(["ABCD", "EfGh"]);
    expect(Object.keys(result).length).toBe(2);
    expect(result.abcd).toEqual({ kind: "unknown" });
    expect(result.efgh).toEqual({ kind: "unknown" });
    expect(result.ABCD).toBeUndefined();
    expect(mock.hits()).toBe(0);
  });

  it("collapses duplicate hashes (last wins, keyed by lowercase)", async () => {
    const mock = makeMockFetch(() => {
      throw new Error("checkCache must not perform any network request");
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const result = await rd.checkCache(["DEAD", "dead", "Beef"]);
    // "DEAD" and "dead" collapse to the single key "dead".
    expect(Object.keys(result).sort()).toEqual(["beef", "dead"]);
    expect(result.dead).toEqual({ kind: "unknown" });
    expect(result.beef).toEqual({ kind: "unknown" });
  });
});

// MARK: - addMagnet (retry-on-5xx, parse failure, non-5xx surface)

describe("RealDebridService addMagnet", () => {
  it("posts the magnet form body and returns the parsed id", async () => {
    let addBody: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents/addMagnet") {
        addBody = req.body;
        return ok(JSON.stringify({ id: "NEWID", uri: "magnet:?..." }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const id = await rd.addMagnet("deadbeef");
    expect(id).toBe("NEWID");

    expect(addBody).not.toBeNull();
    // The body carries the urlencoded magnet (colons are percent-encoded by formValueEncode).
    expect(addBody!.startsWith("magnet=")).toBe(true);
    expect(addBody!).toContain("deadbeef");
    expect(addBody!).toContain("urn%3Abtih%3Adeadbeef");

    // Token is a Bearer header, content-type is form-urlencoded.
    const req = mock.byPath("/rest/1.0/torrents/addMagnet")!;
    expect(req.headers.Authorization).toBe("Bearer rd-token");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("retries on a 5xx and eventually succeeds", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents/addMagnet") {
        attempts += 1;
        if (attempts < 3) return { status: 503, body: "service unavailable" };
        return ok(JSON.stringify({ id: "AFTER_RETRY" }));
      }
      return { status: 404, body: "{}" };
    });
    let sleeps = 0;
    const rd = new RealDebridService("rd-token", mock.fetchImpl, async () => {
      sleeps += 1;
    });
    const id = await rd.addMagnet("abc");
    expect(id).toBe("AFTER_RETRY");
    expect(attempts).toBe(3);
    expect(sleeps).toBe(2); // slept before each of the two retries
  });

  it("exhausts retries on persistent 5xx and throws the last httpError", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents/addMagnet") {
        attempts += 1;
        return { status: 500, body: "boom" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.addMagnet("abc");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(attempts).toBe(5); // maxRetries
    expect(caught?.kind).toBe("httpError");
    expect(caught?.statusCode).toBe(500);
  });

  it("does NOT retry a non-5xx error and surfaces it immediately", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents/addMagnet") {
        attempts += 1;
        return { status: 401, body: "{}" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.addMagnet("abc");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(attempts).toBe(1);
    expect(caught?.kind).toBe("invalidToken");
  });

  it("throws downloadFailed when the response omits a string id", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents/addMagnet") {
        attempts += 1;
        return ok(JSON.stringify({ id: 12345 })); // numeric id is not accepted
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.addMagnet("abc");
    } catch (e) {
      caught = e as DebridError;
    }
    // A parse failure is not a 5xx, so it is not retried.
    expect(attempts).toBe(1);
    expect(caught?.kind).toBe("downloadFailed");
    expect(caught?.detail).toContain("parse magnet response");
  });
});

// MARK: - selectFiles (body formatting + non-2xx surface)

describe("RealDebridService selectFiles", () => {
  it("sends files=all when the id list is empty", async () => {
    let body: string | null = null;
    let path: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/selectFiles/")) {
        body = req.body;
        path = req.url.pathname;
        return { status: 204, body: "" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    await rd.selectFiles("TID", []);
    expect(path).toBe("/rest/1.0/torrents/selectFiles/TID");
    expect(body).toBe("files=all");
  });

  it("sends a comma-joined id list when ids are provided", async () => {
    let body: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/selectFiles/")) {
        body = req.body;
        return { status: 204, body: "" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    await rd.selectFiles("TID", [3, 7, 9]);
    expect(body).toBe("files=3,7,9");
  });

  it("surfaces a non-2xx response as a DebridError", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/selectFiles/")) {
        return { status: 422, body: "bad file id" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.selectFiles("TID", [99]);
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("httpError");
    expect(caught?.statusCode).toBe(422);
  });
});

// MARK: - unrestrictDetailed retry / validation paths

describe("RealDebridService unrestrictDetailed retry + validation", () => {
  it("retries on a 5xx and eventually returns the download URL", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        attempts += 1;
        if (attempts < 2) return { status: 502, body: "bad gateway" };
        return ok(JSON.stringify({ id: "U", download: "https://rd.example/d.mkv" }));
      }
      return { status: 404, body: "{}" };
    });
    let sleeps = 0;
    const rd = new RealDebridService("rd-token", mock.fetchImpl, async () => {
      sleeps += 1;
    });
    const res = await rd.unrestrictDetailed("https://host.example/r/x");
    expect(res.download).toBe("https://rd.example/d.mkv");
    expect(attempts).toBe(2);
    expect(sleeps).toBe(1);
  });

  it("exhausts retries on persistent 5xx and throws the last httpError", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        attempts += 1;
        return { status: 500, body: "down" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.unrestrictDetailed("https://host.example/r/x");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(attempts).toBe(5);
    expect(caught?.kind).toBe("httpError");
    expect(caught?.statusCode).toBe(500);
  });

  it("throws downloadFailed when the download URL is missing", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        attempts += 1;
        return ok(JSON.stringify({ id: "U" })); // no download field
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.unrestrictDetailed("https://host.example/r/x");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(attempts).toBe(1); // not a 5xx -> no retry
    expect(caught?.kind).toBe("downloadFailed");
    expect(caught?.detail).toContain("parse unrestrict response");
  });

  it("throws downloadFailed when the download value is not a valid absolute URL", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        return ok(JSON.stringify({ download: "not a url" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.unrestrictDetailed("https://host.example/r/x");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("downloadFailed");
  });

  it("does not retry a non-5xx (e.g. 403 expired) during unrestrict", async () => {
    let attempts = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/unrestrict/link") {
        attempts += 1;
        return { status: 403, body: "{}" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.unrestrict("https://host.example/r/x");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(attempts).toBe(1);
    expect(caught?.kind).toBe("expired");
  });
});

// MARK: - getStreamURL poll loop + fileCandidates edge cases

describe("RealDebridService getStreamURL poll loop", () => {
  it("selects all files on waiting_files_selection, polls, then resolves once downloaded", async () => {
    let infoCalls = 0;
    let selectBody: string | null = null;
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        infoCalls += 1;
        if (infoCalls === 1) {
          return ok(JSON.stringify({ id: "TP", status: "waiting_files_selection" }));
        }
        if (infoCalls === 2) {
          return ok(JSON.stringify({ id: "TP", status: "downloading" }));
        }
        return ok(
          JSON.stringify({
            id: "TP",
            status: "downloaded",
            filename: "Poll.2026.1080p.mp4",
            bytes: 1000,
            links: ["https://rd.example/poll-link"],
          }),
        );
      }
      if (path.startsWith("/rest/1.0/torrents/selectFiles/")) {
        selectBody = req.body;
        return { status: 204, body: "" };
      }
      if (path === "/rest/1.0/unrestrict/link") {
        return ok(JSON.stringify({ download: "https://rd.example/direct/poll.mp4" }));
      }
      return { status: 404, body: "{}" };
    });
    let sleeps = 0;
    const rd = new RealDebridService("rd-token", mock.fetchImpl, async () => {
      sleeps += 1;
    });
    const stream = await rd.getStreamURL("TP");
    expect(stream.streamURL).toBe("https://rd.example/direct/poll.mp4");
    expect(infoCalls).toBe(3);
    expect(selectBody).toBe("files=all"); // triggered by waiting_files_selection
    expect(sleeps).toBe(2); // slept after attempt 0 and attempt 1 (not after the downloaded one)
  });

  it("throws torrentNotFound when the info body cannot be parsed as an object", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/info/")) {
        return ok(""); // empty body -> parseJSON returns null
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.getStreamURL("TX");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("torrentNotFound");
    expect(caught?.torrentId).toBe("TX");
  });

  it("throws downloadFailed when it never reaches 'downloaded' within maxAttempts", async () => {
    let infoCalls = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/info/")) {
        infoCalls += 1;
        return ok(JSON.stringify({ id: "TS", status: "downloading" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    let caught: DebridError | null = null;
    try {
      await rd.getStreamURL("TS");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(infoCalls).toBe(20); // maxAttempts
    expect(caught?.kind).toBe("downloadFailed");
    expect(caught?.detail).toContain("not ready");
    expect(caught?.detail).toContain("downloading");
  });

  it("uses the fallback name/size when a files array exists but none are selected", async () => {
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({
            id: "TF",
            status: "downloaded",
            filename: "Fallback.2026.720p.mkv",
            bytes: 777,
            links: ["https://rd.example/fb-link"],
            // files present but every entry selected != 1 -> no paired candidates
            files: [
              { id: 1, path: "/a.mkv", bytes: 10, selected: 0 },
              { id: 2, path: "/b.nfo", bytes: 5, selected: 0 },
            ],
          }),
        );
      }
      if (path === "/rest/1.0/unrestrict/link") {
        return ok(JSON.stringify({ download: "https://rd.example/direct/fb.mkv" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const stream = await rd.getStreamURL("TF");
    // Falls back to top-level filename/bytes since no candidate was built from files.
    expect(stream.fileName).toBe("Fallback.2026.720p.mkv");
    expect(stream.sizeBytes).toBe(777);
    expect(stream.quality).toBe("720p");
    expect(stream.codec).toBe("Unknown"); // no codec token in the name
  });

  it("uses a file's filename when path is absent, and coerces string size/selected", async () => {
    let unrestrictBody: string | null = null;
    const mock = makeMockFetch((req) => {
      const path = req.url.pathname;
      if (path.startsWith("/rest/1.0/torrents/info/")) {
        return ok(
          JSON.stringify({
            id: "TC",
            status: "downloaded",
            filename: "ignored-top.mp4",
            links: ["https://rd.example/only-link"],
            files: [
              // selected and bytes given as numeric STRINGS (int64Value coerces them);
              // no `path`, so `filename` is used for the name.
              { id: "4", filename: "Real.2026.2160p.mkv", bytes: "9000", selected: "1" },
            ],
          }),
        );
      }
      if (path === "/rest/1.0/unrestrict/link") {
        unrestrictBody = req.body;
        return ok(JSON.stringify({ download: "https://rd.example/direct/real.mkv" }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const stream = await rd.getStreamURL("TC");
    expect(stream.fileName).toBe("Real.2026.2160p.mkv");
    expect(stream.sizeBytes).toBe(9000);
    expect(stream.quality).toBe("4K"); // 2160p maps to the 4K label
    expect(unrestrictBody!).toContain("only-link");
  });
});

// MARK: - listTorrents pagination + normalization

describe("RealDebridService listTorrents", () => {
  it("walks pages until a short page and normalizes rows", async () => {
    const pageSize = 2;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        const page = req.url.searchParams.get("page");
        if (page === "1") {
          return ok(
            JSON.stringify([
              {
                id: "ID1",
                filename: "A.mkv",
                hash: "ABCDEF",
                status: "downloaded",
                host: "real-debrid.com",
                added: "2026-06-01T00:00:00Z",
                bytes: 100,
                progress: 100,
              },
              { id: "ID2", filename: "B.mkv", hash: "FF00", status: "downloading" },
            ]),
          );
        }
        if (page === "2") {
          // short page (length < pageSize) -> stops after this
          return ok(JSON.stringify([{ id: "ID3", filename: "C.mkv" }]));
        }
        return ok("[]");
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const list = await rd.listTorrents(20, pageSize);
    expect(list.length).toBe(3);

    const first = list[0];
    expect(first.id).toBe("ID1");
    expect(first.name).toBe("A.mkv");
    expect(first.infoHash).toBe("abcdef"); // lowercased
    expect(first.status).toBe("downloaded");
    expect(first.host).toBe("real-debrid.com");
    expect(first.addedAt).toBe("2026-06-01T00:00:00Z");
    expect(first.sizeBytes).toBe(100);
    expect(first.progress).toBe(100);
    expect(first.debridService).toBe("RD");

    // Defensive defaults on the minimal row.
    const third = list[2];
    expect(third.name).toBe("C.mkv");
    expect(third.infoHash).toBeNull();
    expect(third.status).toBe("unknown");
    expect(third.sizeBytes).toBe(0);
    expect(third.progress).toBeNull();

    // Only two pages were requested (stopped at the short page).
    const pages = mock.requests
      .filter((r) => r.url.pathname === "/rest/1.0/torrents")
      .map((r) => r.url.searchParams.get("page"));
    expect(pages).toEqual(["1", "2"]);
  });

  it("stops pagination on an unparseable page rather than throwing", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        const page = req.url.searchParams.get("page");
        if (page === "1") {
          // full page (length === pageSize default 100 not reached, but >0) -> continue
          return ok(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: `X${i}` }))));
        }
        // page 2: garbage / non-array body -> parseJSONArray returns null -> break
        return ok("not json");
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const list = await rd.listTorrents();
    expect(list.length).toBe(100); // partial list survives
  });

  it("returns an empty list when the first page is empty", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") return ok("[]");
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.listTorrents()).toEqual([]);
  });
});

// MARK: - findExistingTorrent pagination + parse-null short-circuit

describe("RealDebridService findExistingTorrent pagination", () => {
  it("walks to a later page to find a match on >100-torrent accounts", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        const page = req.url.searchParams.get("page");
        if (page === "1") {
          // a full page of 100 non-matching rows -> keep paginating
          return ok(
            JSON.stringify(
              Array.from({ length: 100 }, (_, i) => ({
                id: `N${i}`,
                hash: `0000${i}`,
                status: "downloaded",
              })),
            ),
          );
        }
        if (page === "2") {
          return ok(
            JSON.stringify([{ id: "FOUND", hash: "deadbeef", status: "downloaded" }]),
          );
        }
        return ok("[]");
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const id = await rd.findExistingTorrent("DEADBEEF");
    expect(id).toBe("FOUND");
  });

  it("returns null immediately when a page fails to parse as an array", async () => {
    let calls = 0;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        calls += 1;
        return ok("{}"); // an object, not an array -> parseJSONArray null
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.findExistingTorrent("abc")).toBeNull();
    expect(calls).toBe(1);
  });

  it("swallows a failed delete of an error-state match and still returns null", async () => {
    let deleteCalled = false;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname === "/rest/1.0/torrents") {
        return ok(JSON.stringify([{ id: "ERRX", hash: "abcd", status: "magnet_error" }]));
      }
      if (req.url.pathname.startsWith("/rest/1.0/torrents/delete/")) {
        deleteCalled = true;
        return { status: 500, body: "delete failed" }; // raises, but is caught
      }
      return { status: 404, body: "[]" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.findExistingTorrent("ABCD")).toBeNull();
    expect(deleteCalled).toBe(true);
  });
});

// MARK: - deleteTorrent + getMediaInfos

describe("RealDebridService deleteTorrent", () => {
  it("issues a DELETE to the torrent path and treats 204 as success", async () => {
    let method: string | null = null;
    let path: string | null = null;
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/torrents/delete/")) {
        method = req.method;
        path = req.url.pathname;
        return { status: 204, body: "" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    await rd.deleteTorrent("DELME");
    expect(method).toBe("DELETE");
    expect(path).toBe("/rest/1.0/torrents/delete/DELME");
  });
});

describe("RealDebridService getMediaInfos", () => {
  it("returns the parsed object on success", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/streaming/mediaInfos/")) {
        return ok(JSON.stringify({ filename: "x.mkv", details: { video: {} } }));
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    const info = await rd.getMediaInfos("UID");
    expect(info).not.toBeNull();
    expect(info!.filename).toBe("x.mkv");
    expect(mock.byPath("/rest/1.0/streaming/mediaInfos/UID")).toBeTruthy();
  });

  it("returns null on an empty/garbage body", async () => {
    const mock = makeMockFetch((req) => {
      if (req.url.pathname.startsWith("/rest/1.0/streaming/mediaInfos/")) {
        return { status: 200, body: "" };
      }
      return { status: 404, body: "{}" };
    });
    const rd = new RealDebridService("rd-token", mock.fetchImpl);
    expect(await rd.getMediaInfos("UID")).toBeNull();
  });
});
