// Mirrors Tests/.../Services/Indexers/StremioAddonIndexerTests.swift.
//
// The Swift tests stub the network with a per-session MockURLProtocol handler.
// Here we inject a `FetchImpl` stub playing the same role: it captures the last
// requested URL and counts calls. The canned Stremio stream JSON reuses the
// exact shapes from the Swift test file so the TorrentResult mapping is asserted
// identically (infoHash + seeders + size + quality parsed from the title blob).

import { describe, expect, it } from "vitest";
import { IndexerFactory } from "./IndexerFactory";
import { VideoQuality as VQ } from "./models";
import { StremioAddonIndexer } from "./StremioAddonIndexer";
import { type FetchImpl, makeIndexerConfig } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => string | null;
  hits: () => number;
}

function makeMockFetch(handler: (url: string) => MockResponse): MockFetch {
  let count = 0;
  let captured: string | null = null;
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    captured = url;
    const { status, body } = handler(url);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    hits: () => count,
  };
}

function makeMockStreamingFetch(
  handler: (url: string) => { status: number; body: ReadableStream<Uint8Array> },
): MockFetch {
  let count = 0;
  let captured: string | null = null;
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    captured = url;
    const { status, body } = handler(url);
    return { status, body, text: async () => "" };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    hits: () => count,
  };
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("StremioAddonIndexer", () => {
  it("parses Torrentio-style streams (infoHash + seeders + size from title)", async () => {
    const json = JSON.stringify({
      streams: [
        {
          name: "Torrentio\n1080p",
          title:
            "Example.Movie.2026.1080p.WEB-DL.x264\n👤 123 💾 2.1 GB ⚙️ ThePirateBay",
          infoHash: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
          fileIdx: 0,
        },
        {
          name: "Torrentio\n720p",
          title: "Example.Movie.2026.720p.BluRay\n👤 7 💾 900 MB",
          url:
            "magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=Example",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);

    expect(results).toHaveLength(2);

    const first = results.find(
      (r) => r.infoHash === "abcdef1234567890abcdef1234567890abcdef12",
    );
    expect(first).toBeDefined();
    expect(first!.seeders).toBe(123);
    expect(first!.sizeBytes).toBe(2_100_000_000);
    expect(first!.quality).toBe(VQ.hd1080p);
    expect(first!.indexerName).toBe("Torrentio");

    const second = results.find(
      (r) => r.infoHash === "1111111111111111111111111111111111111111",
    );
    expect(second).toBeDefined();
    expect(second!.seeders).toBe(7);
    expect(second!.sizeBytes).toBe(900_000_000);
    expect(second!.quality).toBe(VQ.hd720p);
    expect(second!.magnetURI?.startsWith("magnet:?")).toBe(true);
  });

  it("does not mistake a longer hex blob in a URL for a 40-char info hash", async () => {
    // A stream with no infoHash / no btih param, whose URL embeds a 64-char
    // sha256. The first-40-hex fallback must NOT slice the first 40 chars of it
    // (a wrong hash); with no isolated 40-hex token the stream is dropped. A
    // sibling stream with a real isolated 40-hex run in its path is still kept.
    const sha256 = "a".repeat(64);
    const isolated = "b".repeat(40);
    const json = JSON.stringify({
      streams: [
        { name: "x", title: "No Hash 1080p", url: `https://cdn.example.com/${sha256}/v.mkv` },
        { name: "y", title: "Has Hash 1080p", url: `https://cdn.example.com/${isolated}/v.mkv` },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);

    // The 64-hex blob yields no result; the wrong "first 40" hash never appears.
    expect(results.some((r) => r.infoHash === "a".repeat(40))).toBe(false);
    // The isolated 40-hex run is extracted as a valid hash.
    expect(results.some((r) => r.infoHash === isolated)).toBe(true);
  });

  it("series search builds tt:season:episode stream id", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun/",
      mock.fetchImpl,
    );

    await indexer.search("tt9999999", "series", 2, 5);

    // The colons are percent-encoded on the wire; decode the path back to ':'
    // to assert the Stremio `tt:season:episode` id shape (mirrors the Swift
    // test, which compares the percent-decoded path).
    const url = new URL(mock.lastURL()!);
    expect(decodeURIComponent(url.pathname)).toBe(
      "/stream/series/tt9999999:2:5.json",
    );
  });

  it("strips a configured /manifest.json base before building the stream URL", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));

    // Settings accepts (and connectivity-tests) the addon's manifest URL, so a
    // user may configure the base as `.../manifest.json`. It must not leak into
    // the stream endpoint path.
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun/manifest.json",
      mock.fetchImpl,
    );

    await indexer.search("tt1234567", "movie", null, null);

    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/movie/tt1234567.json");
    expect(mock.lastURL()).not.toContain("manifest.json");
  });

  it("non-IMDb media ids resolve to no streams without a network call", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tmdb-550", "movie", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("streams without a resolvable info hash are dropped", async () => {
    const json = JSON.stringify({
      streams: [
        { title: "No hash here", url: "https://example.com/playlist.m3u8" },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("searchByQuery returns [] (Stremio resolves by IMDb id only)", async () => {
    const mock = makeMockFetch(() => ({ status: 200, body: "{}" }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );
    const results = await indexer.searchByQuery("example", "movie");
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("IndexerFactory builds a StremioAddonIndexer from a stremio_addon config", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Show.S02E05.1080p.WEB\n👤 50 💾 1.5 GB",
          infoHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));

    const indexers = IndexerFactory.buildIndexers(
      [
        makeIndexerConfig({
          id: "addon-1",
          type: "stremio_addon",
          baseURL: "https://torrentio.strem.fun",
          displayName: "My Addon",
          isActive: true,
        }),
        // Disable built-ins so only the Stremio indexer is present.
        makeIndexerConfig({ id: "built-in", type: "built_in", baseURL: "", isActive: false }),
      ],
      mock.fetchImpl,
    );

    expect(indexers.map((i) => i.name)).toEqual(["My Addon"]);

    const results = await indexers[0].search("tt7777777", "series", 2, 5);
    expect(results).toHaveLength(1);
    expect(results[0].infoHash).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(results[0].seeders).toBe(50);
    expect(results[0].quality).toBe(VQ.hd1080p);
  });

  it("IndexerFactory skips a stremio_addon config with an empty base URL", () => {
    const indexers = IndexerFactory.buildIndexers([
      makeIndexerConfig({
        id: "addon-bad",
        type: "stremio_addon",
        baseURL: "   ",
        isActive: true,
      }),
      makeIndexerConfig({ id: "built-in", type: "built_in", baseURL: "", isActive: false }),
    ]);
    expect(indexers).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Error / non-OK responses
  // ---------------------------------------------------------------------------

  it("throws badServerResponse (with status) on a non-2xx response", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "upstream down" }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "badServerResponse", statusCode: 503 });
    // The network was actually hit before failing.
    expect(mock.hits()).toBe(1);
  });

  it("treats a 3xx redirect status as a bad server response (only 200-299 pass)", async () => {
    const mock = makeMockFetch(() => ({
      status: 302,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "badServerResponse", statusCode: 302 });
  });

  it("accepts a non-200 success status in the 2xx range (e.g. 204-ish 299)", async () => {
    const mock = makeMockFetch(() => ({
      status: 299,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("throws cannotParseResponse on a malformed JSON body", async () => {
    const mock = makeMockFetch(() => ({ status: 200, body: "<<not json>>" }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "cannotParseResponse" });
  });

  it("throws cannotParseResponse on an empty body", async () => {
    const mock = makeMockFetch(() => ({ status: 200, body: "" }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "cannotParseResponse" });
  });

  it("decodes a valid-but-empty object body to zero results (streams omitted)", async () => {
    const mock = makeMockFetch(() => ({ status: 200, body: "{}" }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("decodes a null streams field to zero results", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: null }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Bad base URL
  // ---------------------------------------------------------------------------

  it("throws badURL for a whitespace-only base URL (no network call)", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer("Torrentio", "   ", mock.fetchImpl);

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "badURL" });
    expect(mock.hits()).toBe(0);
  });

  it("throws badURL for a base that is only a trailing /manifest.json", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    // After stripping the trailing /manifest.json the base is empty → badURL.
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "/manifest.json",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "badURL" });
    expect(mock.hits()).toBe(0);
  });

  it("throws badURL for an unparseable (space-containing) base URL", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "not a url",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "badURL" });
    expect(mock.hits()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // infoHash resolution
  // ---------------------------------------------------------------------------

  it("extracts the infoHash from an xt=urn:btih: param in a non-magnet url", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Some.Movie.1080p",
          url: "https://example.com/play?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    // Lowercased.
    expect(results[0].infoHash).toBe(
      "abcdef1234567890abcdef1234567890abcdef12",
    );
    // The url was not a magnet, so a synthetic magnet is built (not the url).
    expect(results[0].magnetURI?.startsWith("magnet:?xt=urn:btih:")).toBe(true);
  });

  it("falls back to the first 40-hex run anywhere in the url when no xt param", async () => {
    const hash = "2222222222222222222222222222222222222222";
    const json = JSON.stringify({
      streams: [
        { title: "Movie", url: `https://cdn.example.com/${hash}/file.mkv` },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].infoHash).toBe(hash);
  });

  it("drops a stream when xt present is invalid and no fallback hash exists", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({
        streams: [
          {
            title: "Movie",
            url: "magnet:?xt=urn:btih:not-a-hash",
          },
        ],
      }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("falls back from an invalid direct infoHash to the url's magnet hash", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Movie",
          // Too short to be a valid btih hash → ignored.
          infoHash: "deadbeef",
          url: "magnet:?xt=urn:btih:3333333333333333333333333333333333333333",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].infoHash).toBe(
      "3333333333333333333333333333333333333333",
    );
  });

  it("drops a stream whose direct infoHash is invalid and has no url", async () => {
    const json = JSON.stringify({
      streams: [{ title: "Movie", infoHash: "not-a-hash" }],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("drops a stream whose url contains no 40-hex run", async () => {
    const json = JSON.stringify({
      streams: [{ title: "Movie", url: "https://example.com/stream.m3u8" }],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("keeps a valid stream and drops an unresolvable sibling in the same response", async () => {
    const json = JSON.stringify({
      streams: [
        { title: "Bad", url: "https://example.com/no-hash" },
        {
          title: "Good.1080p",
          infoHash: "4444444444444444444444444444444444444444",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].infoHash).toBe(
      "4444444444444444444444444444444444444444",
    );
  });

  // ---------------------------------------------------------------------------
  // Title / name fallback & size / seeders edge cases
  // ---------------------------------------------------------------------------

  it("falls back to `name` when `title` is absent", async () => {
    const json = JSON.stringify({
      streams: [
        {
          name: "Named.Only.720p\n👤 9 💾 500 MB",
          infoHash: "5555555555555555555555555555555555555555",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(9);
    expect(results[0].sizeBytes).toBe(500_000_000);
    expect(results[0].quality).toBe(VQ.hd720p);
    // Title carries the parsed metadata blob.
    expect(results[0].title).toContain("Named.Only.720p");
  });

  it("uses the bare info hash as the title when neither title nor name is present", async () => {
    const hash = "6666666666666666666666666666666666666666";
    const json = JSON.stringify({ streams: [{ infoHash: hash }] });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    // No seeders / size text → defaults to 0.
    expect(results[0].seeders).toBe(0);
    expect(results[0].sizeBytes).toBe(0);
    // Title is built from the hash (primaryTitle + " " + parseSource, both = hash).
    expect(results[0].title).toBe(`${hash} ${hash}`);
    // No quality keyword → Unknown.
    expect(results[0].quality).toBe(VQ.unknown);
  });

  it("treats a whitespace-only title as empty and falls back to the hash", async () => {
    const hash = "7777777777777777777777777777777777777777";
    const json = JSON.stringify({
      streams: [{ title: "   ", name: "  ", infoHash: hash }],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe(`${hash} ${hash}`);
  });

  it("parses `Seeders:` and `Size:` style metadata", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Movie.1080p Seeders: 42 Size: 512 KB",
          infoHash: "8888888888888888888888888888888888888888",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(42);
    expect(results[0].sizeBytes).toBe(512_000);
  });

  it("falls back when `👤` is present but not numeric and leaves seeders at 0", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Movie.1080p 👤 abc",
          infoHash: "cccccccccccccccccccccccccccccccccccccccc",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(0);
  });

  it("parses short `S:42` seeder notation", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Movie.1080p S:42 💾 1 GB",
          infoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(42);
  });

  it("parses a TB-scale size", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Huge.Movie 4K 💾 1.5 TB",
          infoHash: "9999999999999999999999999999999999999999",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].sizeBytes).toBe(1_500_000_000_000);
    expect(results[0].quality).toBe(VQ.uhd4k);
  });

  it("treats malformed size tokens as missing when unit exists", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Movie.1080p . MB",
          infoHash: "dddddddddddddddddddddddddddddddddddddddd",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].sizeBytes).toBe(0);
  });

  it("uses a byte fallback for unsupported size units", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Odd.Unit 9.8 PB",
          infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].sizeBytes).toBe(9);
  });

  it("defaults seeders and size to 0 when the title has no metadata", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Plain.Movie.Name.1080p",
          infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].seeders).toBe(0);
    expect(results[0].sizeBytes).toBe(0);
  });

  it("uses the first non-empty line as the primary title and collapses newlines for parsing", async () => {
    const json = JSON.stringify({
      streams: [
        {
          title: "Example.Movie.2026.1080p.x265\n👤 5 💾 1 GB",
          infoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2",
        },
      ],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    // Title starts with the first line, then the newline-collapsed full blob.
    expect(results[0].title).toBe(
      "Example.Movie.2026.1080p.x265 Example.Movie.2026.1080p.x265 👤 5 💾 1 GB",
    );
    // Codec parsed from the collapsed blob.
    expect(results[0].codec).toBe("H.265");
    expect(results[0].sizeBytes).toBe(1_000_000_000);
  });

  // ---------------------------------------------------------------------------
  // magnet construction
  // ---------------------------------------------------------------------------

  it("preserves a magnet url verbatim as the magnetURI", async () => {
    const magnet =
      "magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccc03&dn=Foo";
    const json = JSON.stringify({
      streams: [{ title: "Movie", url: magnet }],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].magnetURI).toBe(magnet);
  });

  it("builds a synthetic magnet (hash + url-encoded title) when no magnet url is present", async () => {
    const hash = "dddddddddddddddddddddddddddddddddddddd04";
    const json = JSON.stringify({
      streams: [{ title: "My Movie Name", infoHash: hash.toUpperCase() }],
    });
    const mock = makeMockFetch(() => ({ status: 200, body: json }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0].magnetURI).toBe(
      `magnet:?xt=urn:btih:${hash}&dn=My%20Movie%20Name`,
    );
  });

  // ---------------------------------------------------------------------------
  // id-shape / request building
  // ---------------------------------------------------------------------------

  it("uses the bare id (no season/episode) for a series with missing episode", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    // season present but episode null → no ':season:episode' suffix.
    await indexer.search("tt9999999", "series", 2, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/series/tt9999999.json");
  });

  it("maps a non-movie media type to the series stremio content path", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await indexer.search("tt9999999", "series", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/series/tt9999999.json");
  });

  it("accepts an uppercase TT-prefixed imdb id", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("TT1234567", "movie", null, null);
    expect(results).toEqual([]);
    // It made a request (the tt-prefix check is case-insensitive).
    expect(mock.hits()).toBe(1);
    const url = new URL(mock.lastURL()!);
    // The id is trimmed but not lowercased on the wire.
    expect(url.pathname).toBe("/stream/movie/TT1234567.json");
  });

  it("trims surrounding whitespace from the imdb id before requesting", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await indexer.search("  tt1234567  ", "movie", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/movie/tt1234567.json");
  });

  it("collapses multiple trailing slashes on the base URL", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun///",
      mock.fetchImpl,
    );

    await indexer.search("tt1234567", "movie", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/movie/tt1234567.json");
  });

  it("reads JSON text from a streaming response body", async () => {
    const streamText = JSON.stringify({
      streams: [
        {
          name: "Stream.1080p",
          infoHash: "ffffffffffffffffffffffffffffffffffffffff",
        },
      ],
    });
    const mock = makeMockStreamingFetch(() => ({
      status: 200,
      body: streamFromChunks([new TextEncoder().encode(streamText)]),
    }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(results[0]!.infoHash).toBe(
      "ffffffffffffffffffffffffffffffffffffffff",
    );
  });

  it("throws cannotParseResponse when a streaming body exceeds the cap", async () => {
    const chunk = new TextEncoder().encode("x".repeat(5_000_000));
    const mock = makeMockStreamingFetch(() => ({
      status: 200,
      body: streamFromChunks([chunk, chunk]),
    }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "cannotParseResponse" });
  });

  it("truncates very large non-stream responses to the configured cap before parsing", async () => {
    const streamText = JSON.stringify({ streams: [] });
    const mock = makeMockFetch(() => ({
      status: 200,
      body: `${streamText}${" ".repeat(9_000_000)}`,
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
  });

  it("strips `/manifest.json` and trailing slashes together in one normalization flow", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun/manifest.json///",
      mock.fetchImpl,
    );

    await indexer.search("tt1234567", "movie", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/movie/tt1234567.json");
  });

  it("trims a trailing slash that remains after a manifest suffix replacement", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun/prefix/manifest.json/manifest.json",
      mock.fetchImpl,
    );

    await indexer.search("tt1234567", "movie", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe(
      "/prefix/manifest.json/stream/movie/tt1234567.json",
    );
  });

  it("removes a slash left behind by a manifest suffix replacement", async () => {
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({ streams: [] }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun//manifest.json",
      mock.fetchImpl,
    );

    await indexer.search("tt1234567", "movie", null, null);
    const url = new URL(mock.lastURL()!);
    expect(url.pathname).toBe("/stream/movie/tt1234567.json");
  });

  it("handles non-xt keys before xt and falls back to regex when xt hash is invalid", async () => {
    const fallbackHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mock = makeMockFetch(() => ({
      status: 200,
      body: JSON.stringify({
        streams: [
          {
            title: "Fallback.1080p",
            url: `magnet:?foo=1&XT=not-a-hash&fallback=${fallbackHash}`,
          },
        ],
      }),
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe(fallbackHash);
  });

  it("still rejects a streaming parse failure if reader cancel rejects", async () => {
    const reader = {
      calls: 0,
      read: async () => {
        reader.calls += 1;
        if (reader.calls === 1) {
          return { done: false, value: null };
        }
        if (reader.calls === 2) {
          return { done: true, value: undefined };
        }
        return { done: true, value: undefined };
      },
      cancel: async () => {
        throw new Error("reader cancel failed");
      },
    };
    const mock = makeMockFetch(() => ({
      status: 200,
      body: {
        getReader: () => reader,
      } as unknown as ReadableStream<Uint8Array>,
    }));

    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "cannotParseResponse" });
  });

  it("uses an empty chunk when a stream reader returns a null payload", async () => {
    const reader = {
      calls: 0,
      read: async () => {
        reader.calls += 1;
        if (reader.calls === 1) {
          return { done: false, value: null };
        }
        return { done: true, value: null };
      },
      cancel: async () => {},
    };
    const mock = makeMockFetch(() => ({
      status: 200,
      body: {
        getReader: () => reader,
      } as unknown as ReadableStream<Uint8Array>,
    }));
    const indexer = new StremioAddonIndexer(
      "Torrentio",
      "https://torrentio.strem.fun",
      mock.fetchImpl,
    );

    await expect(
      indexer.search("tt1234567", "movie", null, null),
    ).rejects.toMatchObject({ kind: "cannotParseResponse" });
  });
});
