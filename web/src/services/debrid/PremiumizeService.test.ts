// Mirrors Tests/.../Services/Debrid/PremiumizeServiceTests.swift.

import { describe, expect, it, vi } from "vitest";
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

interface RequestRawInvoker {
  requestRaw(
    path: string,
    method: string,
    queryParams?: string,
    body?: string,
  ): Promise<string>;
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

// MARK: - constructor

describe("PremiumizeService constructor", () => {
  it("defaults to global fetch when no fetch implementation is supplied", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ response: [false], filename: [null], filesize: [null] }),
      } as Response);
    try {
      const service = new PremiumizeService("pm-token");
      const result = await service.checkCache(["HASHX"]);
      expect(result.hashx).toEqual({ kind: "notCached" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("PremiumizeService selectFiles", () => {
  it("is a no-op for Premiumize and returns resolved void", async () => {
    const fetchImpl = async () => {
      throw new Error("should not be called");
    };
    const service = new PremiumizeService("pm-token", fetchImpl);
    await expect(service.selectFiles("torrent-id", [1, 2, 3])).resolves.toBeUndefined();
  });
});

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

// MARK: - requestRaw

describe("PremiumizeService requestRaw", () => {
  it("emits only the auth body component when body is an empty string", async () => {
    const mock = makeMockFetch(() => ok("{}"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const raw = service as unknown as RequestRawInvoker;
    await raw.requestRaw("/account/info", "GET", undefined, "");

    const req = mock.byPath("/api/account/info")!;
    expect(req.body).toBe("apikey=pm-token");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("uses empty fallback text when response.text() rejects for non-2xx", async () => {
    const fetchImpl: FetchImpl = async () => ({
      status: 500,
      text: async () => {
        throw new Error("text read failed");
      },
    });
    const service = new PremiumizeService("pm-token", fetchImpl);
    const raw = service as unknown as RequestRawInvoker;

    let caught: DebridError | null = null;
    try {
      await raw.requestRaw("/transfer/directdl", "POST", undefined, "x");
    } catch (error) {
      caught = error as DebridError;
    }

    expect(caught?.equals(DebridError.httpError(500, ""))).toBe(true);
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

// MARK: - getStreamURL (edge cases)

describe("PremiumizeService getStreamURL edge cases", () => {
  it("polls until content appears, sleeping between attempts", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const mock = makeMockFetch(() => {
      attempts += 1;
      if (attempts < 3) {
        // Empty content array -> keep polling.
        return ok(JSON.stringify({ content: [] }));
      }
      return ok(
        JSON.stringify({
          content: [{ link: "https://pm.example/late.mkv", path: "late.mkv", size: 99 }],
        }),
      );
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl, async (ms) => {
      sleeps.push(ms);
    });
    const stream = await service.getStreamURL("slow");

    expect(attempts).toBe(3);
    // Slept once after attempt 0 and once after attempt 1 (not after the success).
    expect(sleeps).toEqual([1000, 1000]);
    expect(stream.streamURL).toBe("https://pm.example/late.mkv");
  });

  it("throws noFilesAvailable after exhausting all 20 attempts with empty content", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const mock = makeMockFetch(() => {
      attempts += 1;
      return ok(JSON.stringify({ content: [] }));
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl, async (ms) => {
      sleeps.push(ms);
    });

    await expect(service.getStreamURL("never")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
    // 20 attempts, sleeping after all but the last.
    expect(attempts).toBe(20);
    expect(sleeps.length).toBe(19);
  });

  it("throws noFilesAvailable when the directdl response is malformed JSON", async () => {
    const mock = makeMockFetch(() => ok("not json at all"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.getStreamURL("bad")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
  });

  it("throws noFilesAvailable when content is not an array", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ content: { link: "https://pm.example/x.mkv" } })),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.getStreamURL("notarray")).rejects.toMatchObject({
      kind: "noFilesAvailable",
    });
  });

  it("skips items without a string link but still selects a valid sibling", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          content: [
            { link: 12345, path: "broken.mkv", size: 10 },
            { path: "noLinkField.mkv", size: 20 },
            { link: "https://pm.example/good.mkv", path: "good.mkv", size: 30 },
          ],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const stream = await service.getStreamURL("mixed");
    expect(stream.streamURL).toBe("https://pm.example/good.mkv");
    expect(stream.fileName).toBe("good.mkv");
  });

  it("defaults a missing/non-string path to 'Unknown' and coerces a string size", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          content: [{ link: "https://pm.example/only.mkv", size: "7340032" }],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const stream = await service.getStreamURL("nopath");
    // path missing -> "Unknown"; lastPathComponent("Unknown") === "Unknown".
    expect(stream.fileName).toBe("Unknown");
    // size "7340032" coerced via int64Value.
    expect(stream.sizeBytes).toBe(7_340_032);
  });

  it("treats an unparseable size as 0", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          content: [{ link: "https://pm.example/z.mkv", path: "z.mkv", size: {} }],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const stream = await service.getStreamURL("badsize");
    expect(stream.sizeBytes).toBe(0);
  });

  it("propagates a non-401 HTTP error from the directdl call", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "boom" }));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);

    let caught: DebridError | null = null;
    try {
      await service.getStreamURL("err");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.equals(DebridError.httpError(500, "boom"))).toBe(true);
  });
});

// MARK: - checkCache (edge cases)

describe("PremiumizeService checkCache edge cases", () => {
  it("produces no entries when the response is malformed JSON", async () => {
    const mock = makeMockFetch(() => ok("<<<not json>>>"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHX"]);
    expect(Object.keys(result).length).toBe(0);
  });

  it("produces no entries when one of the parallel arrays is missing", async () => {
    // filesize array absent -> the response/filename/filesize guard fails.
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ response: [true], filename: ["A.mkv"] })),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHX"]);
    expect(Object.keys(result).length).toBe(0);
  });

  it("lowercases the hash key when mapping cache results", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          response: [true],
          filename: ["File.mkv"],
          filesize: [42],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["AbCdEf"]);
    expect(result.abcdef).toEqual({
      kind: "cached",
      fileId: null,
      fileName: "File.mkv",
      fileSize: 42,
    });
  });

  it("uses null filename/filesize when their array entries are the wrong type", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          response: [true],
          filename: [999], // not a string -> name null
          filesize: ["123"], // not a number -> size null
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHX"]);
    expect(result.hashx).toEqual({
      kind: "cached",
      fileId: null,
      fileName: null,
      fileSize: null,
    });
  });

  it("uses null filename/filesize when the parallel arrays are shorter than response", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          response: [true],
          filename: [], // shorter than response -> i >= length
          filesize: [],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHX"]);
    expect(result.hashx).toEqual({
      kind: "cached",
      fileId: null,
      fileName: null,
      fileSize: null,
    });
  });

  it("skips hashes whose index is beyond the response array length", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          response: [true], // only one entry for two hashes
          filename: ["First.mkv"],
          filesize: [100],
        }),
      ),
    );
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(["HASHONE", "HASHTWO"]);
    expect(result.hashone).toEqual({
      kind: "cached",
      fileId: null,
      fileName: "First.mkv",
      fileSize: 100,
    });
    // Second hash had no corresponding response slot -> absent.
    expect(result.hashtwo).toBeUndefined();
  });

  it("chunks more than 100 hashes into separate requests", async () => {
    const hashes = Array.from({ length: 150 }, (_, i) => `HASH${i}`);
    let requestCount = 0;
    const itemsPerRequest: number[] = [];
    const mock = makeMockFetch((req) => {
      requestCount += 1;
      const items = req.url.searchParams.getAll("items[]");
      itemsPerRequest.push(items.length);
      return ok(
        JSON.stringify({
          response: items.map(() => false),
          filename: items.map(() => null),
          filesize: items.map(() => null),
        }),
      );
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const result = await service.checkCache(hashes);

    expect(requestCount).toBe(2);
    expect(itemsPerRequest).toEqual([100, 50]);
    expect(Object.keys(result).length).toBe(150);
    expect(result.hash0).toEqual({ kind: "notCached" });
  });

  it("does not leak the apikey into the cache/check query string", async () => {
    let query = "";
    const mock = makeMockFetch((req) => {
      query = req.url.search;
      return ok(JSON.stringify({ response: [false], filename: [null], filesize: [null] }));
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await service.checkCache(["HASHX"]);
    expect(query.includes("apikey=")).toBe(false);
    expect(query).toContain("items[]=HASHX");
  });
});

// MARK: - addMagnet

describe("PremiumizeService addMagnet", () => {
  it("returns the transfer id and sends the magnet in the body (apikey appended, not in query)", async () => {
    let body = "";
    let query = "";
    const mock = makeMockFetch((req) => {
      body = req.body;
      query = req.url.search;
      return ok(JSON.stringify({ id: "transfer-42" }));
    });
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const id = await service.addMagnet("ABCDEF0123456789");

    expect(id).toBe("transfer-42");
    expect(body).toContain("src=");
    expect(body).toContain("magnet%3A%3Fxt%3Durn%3Abtih%3AABCDEF0123456789");
    expect(body).toContain("apikey=pm-token");
    expect(query.includes("apikey=")).toBe(false);
  });

  it("throws downloadFailed when the response has no id", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ status: "success" })));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.addMagnet("HASH")).rejects.toMatchObject({
      kind: "downloadFailed",
      detail: "Failed to add magnet to Premiumize",
    });
  });

  it("throws downloadFailed when id is present but not a string", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ id: 12345 })));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.addMagnet("HASH")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });

  it("throws downloadFailed when the response is malformed JSON", async () => {
    const mock = makeMockFetch(() => ok("oops"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.addMagnet("HASH")).rejects.toMatchObject({
      kind: "downloadFailed",
    });
  });
});

// MARK: - unrestrict (edge cases)

describe("PremiumizeService unrestrict edge cases", () => {
  it("throws downloadFailed for a non-absolute link", async () => {
    const service = new PremiumizeService("pm-token", makeMockFetch(() => ok("{}")).fetchImpl);
    await expect(service.unrestrict("not-a-url")).rejects.toMatchObject({
      kind: "downloadFailed",
      detail: "Invalid link",
    });
  });
});

// MARK: - getAccountInfo (edge cases)

describe("PremiumizeService getAccountInfo edge cases", () => {
  it("throws invalidToken when the body is not a JSON object", async () => {
    const mock = makeMockFetch(() => ok("[]"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    await expect(service.getAccountInfo()).rejects.toMatchObject({
      kind: "invalidToken",
    });
  });

  it("defaults username to 'Unknown' when customer_id is missing", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ premium_until: 1700000000 })));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    const info = await service.getAccountInfo();
    expect(info.username).toBe("Unknown");
    expect(info.isPremium).toBe(true);
  });

  it("sends auth headers (Bearer + X-API-Key) and no body for the GET", async () => {
    let captured: CapturedRequest | undefined;
    const mock = makeMockFetch((req) => {
      captured = req;
      return ok(JSON.stringify({ customer_id: "u" }));
    });
    const service = new PremiumizeService("my-token", mock.fetchImpl);
    await service.getAccountInfo();

    expect(captured?.headers.Authorization).toBe("Bearer my-token");
    expect(captured?.headers["X-API-Key"]).toBe("my-token");
    // GET with no body component -> no apikey in body and no Content-Type.
    expect(captured?.body).toBe("");
    expect(captured?.headers["Content-Type"]).toBeUndefined();
  });
});

// MARK: - validateToken (edge cases)

describe("PremiumizeService validateToken edge cases", () => {
  it("returns false when the account body is not a JSON object", async () => {
    const mock = makeMockFetch(() => ok("null"));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    expect(await service.validateToken()).toBe(false);
  });

  it("returns false on a 503 server error", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "down" }));
    const service = new PremiumizeService("pm-token", mock.fetchImpl);
    expect(await service.validateToken()).toBe(false);
  });
});
