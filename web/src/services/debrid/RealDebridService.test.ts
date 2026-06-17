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
});
