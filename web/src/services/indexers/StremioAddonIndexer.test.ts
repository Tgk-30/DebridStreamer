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
});
