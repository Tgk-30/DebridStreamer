// Focused unit coverage for the Torznab/Jackett/Prowlarr indexer
// (src/services/indexers/TorznabIndexer.ts). Complements the broader
// indexers.test.ts suite by drilling into the hand-rolled XML tokenizer +
// parseTorznabFeed semantics, decodeEntities (incl. out-of-range numeric
// entities via fromCodePointOr), magnet-vs-infohash extraction, the category
// (`cat`) query mapping, malformed XML, and the empty feed.
//
// The network is stubbed via an injected `FetchImpl` (same pattern as
// indexers.test.ts / StremioAddonIndexer.test.ts): it captures the last URL +
// headers and counts calls. Every assertion mirrors what the source ACTUALLY
// does — read TorznabIndexer.ts carefully for the exact event ordering.

import { describe, expect, it, vi } from "vitest";
import { parseTorznabFeed, TorznabIndexer } from "./TorznabIndexer";
import type { FetchImpl } from "./types";

// MARK: - fetch stub (mirrors indexers.test.ts makeMockFetch)

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => URL | null;
  lastHeaders: () => Record<string, string> | undefined;
  history: () => string[];
  hits: () => number;
}

function makeMockFetch(
  handler: (url: URL, hit: number) => MockResponse,
): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  let capturedHeaders: Record<string, string> | undefined;
  const capturedHistory: string[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    capturedHeaders = init?.headers;
    capturedHistory.push(parsed.toString());
    const { status, body } = handler(parsed, count);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    lastHeaders: () => capturedHeaders,
    history: () => capturedHistory,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

function makeIndexer(opts: {
  fetchImpl: FetchImpl;
  baseURL?: string;
  endpointPath?: string;
  apiKey?: string | null;
  categoryFilter?: string | null;
  sendAPIKeyAsHeader?: boolean;
  name?: string;
}): TorznabIndexer {
  return new TorznabIndexer({
    name: opts.name ?? "Jackett",
    baseURL: opts.baseURL ?? "http://localhost:9117",
    endpointPath: opts.endpointPath ?? "/api",
    apiKey: opts.apiKey ?? null,
    categoryFilter: opts.categoryFilter ?? null,
    sendAPIKeyAsHeader: opts.sendAPIKeyAsHeader ?? false,
    fetchImpl: opts.fetchImpl,
  });
}

// ============================================================================
// parseTorznabFeed — XML parsing & event semantics
// ============================================================================

describe("parseTorznabFeed: XML parsing", () => {
  it("parses a full item with title / size element / seeders / peers / infohash", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
  <item>
    <title>Example.Movie.2026.1080p.WEB-DL</title>
    <size>1500000000</size>
    <torznab:attr name="seeders" value="123"/>
    <torznab:attr name="peers" value="4"/>
    <torznab:attr name="infohash" value="ABCDEF1234567890ABCDEF1234567890ABCDEF12"/>
  </item>
</channel></rss>`;
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Example.Movie.2026.1080p.WEB-DL");
    expect(items[0]?.size).toBe(1_500_000_000);
    expect(items[0]?.seeders).toBe(123);
    expect(items[0]?.peers).toBe(4);
    expect(items[0]?.infoHash).toBe("ABCDEF1234567890ABCDEF1234567890ABCDEF12");
    // No magnet/link/enclosure present.
    expect(items[0]?.magnetURL).toBeNull();
  });

  it("parses multiple <item> elements in document order", () => {
    const xml =
      "<rss><channel>" +
      "<item><title>First</title><size>10</size></item>" +
      "<item><title>Second</title><size>20</size></item>" +
      "<item><title>Third</title><size>30</size></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.map((i) => i.title)).toEqual(["First", "Second", "Third"]);
    expect(items.map((i) => i.size)).toEqual([10, 20, 30]);
  });

  it("defaults numeric fields (size/seeders/peers) to 0 when absent", () => {
    const xml =
      "<rss><channel><item><title>Bare</title></item></channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.size).toBe(0);
    expect(items[0]?.seeders).toBe(0);
    expect(items[0]?.peers).toBe(0);
    expect(items[0]?.infoHash).toBeNull();
    expect(items[0]?.magnetURL).toBeNull();
  });

  it("defaults a missing/empty title to 'Unknown'", () => {
    const xml =
      "<rss><channel><item><size>1</size></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.title).toBe("Unknown");

    const emptyTitle =
      "<rss><channel><item><title>   </title></item></channel></rss>";
    // Whitespace-only title is trimmed to "" then defaulted to "Unknown".
    expect(parseTorznabFeed(emptyTitle)[0]?.title).toBe("Unknown");
  });

  it("trims surrounding whitespace from the title text", () => {
    const xml =
      "<rss><channel><item><title>  Spaced Title  </title></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.title).toBe("Spaced Title");
  });

  it("ignores attributes/elements appearing before any <item> opens", () => {
    const xml =
      "<rss><channel>" +
      "<title>Feed Title</title>" + // belongs to channel, no current item
      '<torznab:attr name="seeders" value="999"/>' +
      "<item><title>Real</title></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Real");
    expect(items[0]?.seeders).toBe(0);
  });

  it("a fresh <item> resets the accumulator (no leakage between items)", () => {
    const xml =
      "<rss><channel>" +
      '<item><title>A</title><size>111</size><torznab:attr name="seeders" value="7"/></item>' +
      "<item><title>B</title></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items[1]?.title).toBe("B");
    expect(items[1]?.size).toBe(0);
    expect(items[1]?.seeders).toBe(0);
  });

  it("CDATA title is taken literally without entity decoding", () => {
    const xml =
      "<rss><channel><item>" +
      "<title><![CDATA[A & B <raw> \"q\"]]></title>" +
      "</item></channel></rss>";
    // CDATA path in tokenizeXML emits inner text verbatim.
    expect(parseTorznabFeed(xml)[0]?.title).toBe('A & B <raw> "q"');
  });

  it("skips XML declaration, comments, and DOCTYPE", () => {
    const xml =
      '<?xml version="1.0"?>' +
      "<!DOCTYPE rss>" +
      "<rss><channel>" +
      "<!-- a comment with <item> text that must be ignored -->" +
      "<item><title>Only</title></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Only");
  });

  it("element names are matched case-insensitively", () => {
    const xml =
      "<RSS><Channel><ITEM><Title>Mixed</Title><SIZE>42</SIZE></ITEM></Channel></RSS>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Mixed");
    expect(items[0]?.size).toBe(42);
  });

  it("handles malformed tags by skipping empty names while still parsing valid items", () => {
    const xml =
      "<rss><channel>" +
      "<item><title>A</title></item>" +
      "<item><title>B</title><></item></item>" +
      "<item><title>C</title></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.map((item) => item.title)).toEqual(["A", "B", "C"]);
  });

  it("accepts a non-closed DOCTYPE declaration and still parses normal tags", () => {
    const xml =
      '<?xml version="1.0"?>' +
      "<rss><channel>" +
      "<item><title>One</title></item>" +
      "<item><title>Two</title></item>" +
      "</channel></rss><!DOCTYPE rss";
    const items = parseTorznabFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("One");
    expect(items[1]?.title).toBe("Two");
  });

  it("ignores a processing instruction with no closing sequence", () => {
    const xml =
      "<rss><channel><item><title>One</title></item></channel></rss>" +
      '<?xml version="1.0"';
    const items = parseTorznabFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("One");
  });

  it("ignores an unterminated comment block and still parses regular tags", () => {
    const xml =
      "<rss><channel>" +
      "<item><title>One</title></item>" +
      "<!-- missing close" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("One");
  });

  it("accepts a non-closed CDATA section and keeps already-closed items", () => {
    const xml =
      "<rss><channel>" +
      "<item><title>One</title></item>" +
      "</channel></rss><![CDATA[unterminated";
    const items = parseTorznabFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("One");
  });

  it("ignores empty end tags like </> without throwing", () => {
    const xml =
      "<rss><channel>" +
      "<item><title>One</title></item>" +
      "</>" +
      "<item><title>Two</title></item>" +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.title)).toEqual(["One", "Two"]);
  });

  it("continues through leading text before the first tag", () => {
    const items = parseTorznabFeed(
      "prefix text<rss><channel><item><title>D</title></item></channel></rss>",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("D");
  });
});

// ============================================================================
// size / seeders / peers parsing edge cases
// ============================================================================

describe("parseTorznabFeed: numeric parsing", () => {
  it("reads size from the torznab:attr name='size' value", () => {
    const xml =
      '<rss xmlns:torznab="x"><channel><item><title>A</title>' +
      '<torznab:attr name="size" value="777"/></item></channel></rss>';
    expect(parseTorznabFeed(xml)[0]?.size).toBe(777);
  });

  it("reads size from a plain <size> element", () => {
    const xml =
      "<rss><channel><item><title>A</title><size>888</size></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.size).toBe(888);
  });

  it("parseInt keeps the leading-numeric prefix (e.g. '500abc' -> 500)", () => {
    const xml =
      "<rss><channel><item><title>A</title><size>500abc</size>" +
      '<torznab:attr name="seeders" value="42xyz"/></item></channel></rss>';
    const item = parseTorznabFeed(xml)[0];
    expect(item?.size).toBe(500);
    expect(item?.seeders).toBe(42);
  });

  it("keeps the default (0) when a numeric value is non-numeric (NaN guard)", () => {
    const xml =
      "<rss><channel><item><title>A</title><size>notanumber</size>" +
      '<torznab:attr name="seeders" value="abc"/>' +
      '<torznab:attr name="peers" value=""/></item></channel></rss>';
    const item = parseTorznabFeed(xml)[0];
    expect(item?.size).toBe(0);
    expect(item?.seeders).toBe(0);
    expect(item?.peers).toBe(0);
  });

  it("a later valid <size> element overrides an earlier torznab:attr size", () => {
    const xml =
      '<rss xmlns:torznab="x"><channel><item><title>A</title>' +
      '<torznab:attr name="size" value="100"/>' +
      "<size>200</size></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.size).toBe(200);
  });

  it("an unknown torznab:attr name is ignored", () => {
    const xml =
      '<rss xmlns:torznab="x"><channel><item><title>A</title>' +
      '<torznab:attr name="category" value="2000"/>' +
      '<torznab:attr name="seeders" value="5"/></item></channel></rss>';
    const item = parseTorznabFeed(xml)[0];
    expect(item?.seeders).toBe(5);
    expect(item?.size).toBe(0);
  });

  it("supports attr tuples with missing names/values and malformed numeric text", () => {
    const xml =
      '<rss xmlns:torznab="x"><channel><item><title>A</title>' +
      '<torznab:attr value="777"/>' +
      '<torznab:attr name="peers"/>' +
      '<torznab:attr name="size" value="bad"/>' +
      '<torznab:attr name=\'seeders\' value=\'11\'/>' +
      "</item></channel></rss>";
    const item = parseTorznabFeed(xml)[0];
    expect(item?.peers).toBe(0);
    expect(item?.size).toBe(0);
    expect(item?.seeders).toBe(11);
  });

  it("parses torznab:attr values written with single-quoted values", () => {
    const xml =
      "<rss xmlns:torznab=\"x\"><channel><item><title>A</title>" +
      "<torznab:attr name='size' value='777'/>" +
      "<torznab:attr name='seeders' value='9'/>" +
      "<torznab:attr name='peers' value='3'/>" +
      "</item></channel></rss>";
    const item = parseTorznabFeed(xml)[0];
    expect(item?.size).toBe(777);
    expect(item?.seeders).toBe(9);
    expect(item?.peers).toBe(3);
  });
});

// ============================================================================
// magnet vs infohash extraction
// ============================================================================

describe("parseTorznabFeed: magnet/infohash extraction", () => {
  it("reads the magnet URL from an <enclosure url=...> attribute", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      '<enclosure url="magnet:?xt=urn:btih:ZZ" type="application/x-bittorrent"/>' +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe("magnet:?xt=urn:btih:ZZ");
  });

  it("reads a magnet from <guid> when it starts with magnet:?", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      "<guid>magnet:?xt=urn:btih:ABC&dn=name</guid>" +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe(
      "magnet:?xt=urn:btih:ABC&dn=name",
    );
  });

  it("reads a magnet from <link> when it starts with magnet:?", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      "<link>magnet:?xt=urn:btih:DEF</link>" +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe("magnet:?xt=urn:btih:DEF");
  });

  it("the magnet:? prefix check on guid/link is case-insensitive", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      "<guid>MAGNET:?xt=urn:btih:CASE</guid>" +
      "</item></channel></rss>";
    // value is preserved as-is (only the prefix test is lowercased).
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe("MAGNET:?xt=urn:btih:CASE");
  });

  it("a non-magnet <guid>/<link> http URL does NOT become the magnetURL", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      "<guid isPermaLink=\"true\">https://tracker/details/1</guid>" +
      "<link>https://tracker/download/1.torrent</link>" +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBeNull();
  });

  it("torznab:attr magneturl sets the magnet URL", () => {
    const xml =
      '<rss xmlns:torznab="x"><channel><item><title>X</title>' +
      '<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:FROMATTR"/>' +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe(
      "magnet:?xt=urn:btih:FROMATTR",
    );
  });
});

// ============================================================================
// decodeEntities (incl. fromCodePointOr out-of-range handling)
// ============================================================================

describe("parseTorznabFeed: decodeEntities", () => {
  it("decodes named entities lt/gt/quot/apos/amp in element text", () => {
    const xml =
      "<rss><channel><item>" +
      "<title>A &lt;B&gt; &quot;C&quot; &apos;D&apos; &amp; E</title>" +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.title).toBe(`A <B> "C" 'D' & E`);
  });

  it("decodes decimal numeric entities (&#65; -> A)", () => {
    const xml =
      "<rss><channel><item><title>&#72;&#105;</title></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.title).toBe("Hi");
  });

  it("decodes hex numeric entities (&#x41; -> A, case-insensitive hex)", () => {
    const xml =
      "<rss><channel><item><title>&#x48;&#x69;&#X2e;</title></item></channel></rss>";
    // Note: &#X2e; uppercase X is NOT matched by the lowercase-x regex, so it
    // stays literal. Only &#x48; and &#x69; decode.
    expect(parseTorznabFeed(xml)[0]?.title).toBe("Hi&#X2e;");
  });

  it("decodes a high astral-plane code point (&#x1F600; emoji)", () => {
    const xml =
      "<rss><channel><item><title>x&#x1F600;y</title></item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.title).toBe("x\u{1F600}y");
  });

  it("leaves an out-of-range decimal entity (> 0x10FFFF) as literal text and does not throw", () => {
    const xml =
      "<rss><channel><item>" +
      "<title>Bad &#1114112; Title</title>" + // 0x110000, out of range
      "<size>500</size></item></channel></rss>";
    let items: ReturnType<typeof parseTorznabFeed> = [];
    expect(() => {
      items = parseTorznabFeed(xml);
    }).not.toThrow();
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Bad &#1114112; Title");
    expect(items[0]?.size).toBe(500);
  });

  it("leaves a surrogate-range numeric entity (&#xD800;) as literal text", () => {
    const xml =
      "<rss><channel><item><title>S&#xD800;E</title></item></channel></rss>";
    // 0xD800 is a surrogate -> fromCodePointOr returns the literal match.
    expect(parseTorznabFeed(xml)[0]?.title).toBe("S&#xD800;E");
  });

  it("decodes entities inside tag attribute values (enclosure url)", () => {
    const xml =
      "<rss><channel><item><title>X</title>" +
      '<enclosure url="magnet:?xt=urn:btih:HASH&amp;dn=A&amp;tr=udp://x"/>' +
      "</item></channel></rss>";
    expect(parseTorznabFeed(xml)[0]?.magnetURL).toBe(
      "magnet:?xt=urn:btih:HASH&dn=A&tr=udp://x",
    );
  });

  it("decodes &amp; last so &amp;lt; round-trips to &lt; not <", () => {
    const xml =
      "<rss><channel><item><title>&amp;lt;</title></item></channel></rss>";
    // &amp; -> & happens after &lt; replacement, so the literal output is "&lt;".
    expect(parseTorznabFeed(xml)[0]?.title).toBe("&lt;");
  });
});

// ============================================================================
// malformed / empty XML
// ============================================================================

describe("parseTorznabFeed: malformed & empty feeds", () => {
  it("returns [] for an empty string", () => {
    expect(parseTorznabFeed("")).toEqual([]);
  });

  it("returns [] for an empty channel (no items)", () => {
    expect(parseTorznabFeed("<rss><channel></channel></rss>")).toEqual([]);
  });

  it("returns [] for the Torznab error envelope (no <item>)", () => {
    const xml =
      '<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>';
    expect(parseTorznabFeed(xml)).toEqual([]);
  });

  it("returns [] for plain non-XML text", () => {
    expect(parseTorznabFeed("totally not xml at all")).toEqual([]);
  });

  it("an unterminated <item> (no closing </item>) is never finalized -> []", () => {
    const xml = "<rss><channel><item><title>Dangling</title>";
    // </item> never fires, so the item is never pushed.
    expect(parseTorznabFeed(xml)).toEqual([]);
  });

  it("a malformed trailing '<' with no '>' is treated as text and does not throw", () => {
    const xml =
      "<rss><channel><item><title>OK</title></item></channel></rss><broken";
    let items: ReturnType<typeof parseTorznabFeed> = [];
    expect(() => {
      items = parseTorznabFeed(xml);
    }).not.toThrow();
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("OK");
  });

  it("handles self-closing <item/> (start then immediate end) -> finalized empty item", () => {
    const xml = "<rss><channel><item/></channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Unknown");
    expect(items[0]?.size).toBe(0);
  });

  it("an end tag with no matching open item is ignored", () => {
    const xml = "<rss><channel></item></channel></rss>";
    expect(parseTorznabFeed(xml)).toEqual([]);
  });
});

// ============================================================================
// TorznabIndexer.search / searchByQuery — request building & result mapping
// ============================================================================

describe("TorznabIndexer: request building", () => {
  it("searchByQuery sends t=search and q=<query>", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    await indexer.searchByQuery("the matrix", "movie");
    const url = mock.lastURL()!;
    expect(url.searchParams.get("t")).toBe("search");
    expect(url.searchParams.get("q")).toBe("the matrix");
    expect(url.searchParams.get("imdbid")).toBeNull();
  });

  it("search sends t=search and imdbid, and includes season/ep only when provided", async () => {
    const mock = makeMockFetch(() =>
      ok(
        `<rss><channel><item>
          <title>Any</title>
          <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
          <size>1</size>
        </item></channel></rss>`,
      ),
    );
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    await indexer.search("tt9999999", "series", 3, 7);
    const url = mock.lastURL()!;
    expect(url.searchParams.get("t")).toBe("search");
    expect(url.searchParams.get("imdbid")).toBe("tt9999999");
    expect(url.searchParams.get("season")).toBe("3");
    expect(url.searchParams.get("ep")).toBe("7");
  });

  it("search omits season/ep params when null", async () => {
    const mock = makeMockFetch(() =>
      ok(
        `<rss><channel><item>
          <title>Any</title>
          <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
          <size>1</size>
        </item></channel></rss>`,
      ),
    );
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    await indexer.search("tt1234567", "movie", null, null);
    const url = mock.lastURL()!;
    expect(url.searchParams.get("imdbid")).toBe("tt1234567");
    expect(url.searchParams.has("season")).toBe(false);
    expect(url.searchParams.has("ep")).toBe(false);
  });

  it("season 0 / episode 0 ARE included (null check, not falsy)", async () => {
    const mock = makeMockFetch(() =>
      ok(
        `<rss><channel><item>
          <title>Any</title>
          <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
          <size>1</size>
        </item></channel></rss>`,
      ),
    );
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    await indexer.search("tt1", "series", 0, 0);
    const url = mock.lastURL()!;
    expect(url.searchParams.get("season")).toBe("0");
    expect(url.searchParams.get("ep")).toBe("0");
  });

  it("joins endpointPath onto the base path, trimming slashes", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      baseURL: "http://localhost:9117/base/",
      endpointPath: "/api/v2.0/results/",
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.pathname).toBe("/base/api/v2.0/results");
  });

  it("an empty endpointPath leaves the base path untouched", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      baseURL: "http://localhost:9117",
      endpointPath: "",
    });
    await indexer.searchByQuery("x", "movie");
    // URL reports an empty path as "/".
    expect(mock.lastURL()!.pathname).toBe("/");
  });

  it("treats endpointPath='/' as an empty append and keeps the base path", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      baseURL: "http://localhost:9117/base",
      endpointPath: "/",
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.pathname).toBe("/base");
  });

  it("returns [] for whitespace-only query in searchByQuery", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("   ", "movie");
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("throws badURL for an unparseable base URL", async () => {
    const mock = makeMockFetch(() => ok("<rss></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      baseURL: "not a url",
    });
    await expect(indexer.searchByQuery("x", "movie")).rejects.toMatchObject({
      kind: "badURL",
    });
    expect(mock.hits()).toBe(0);
  });

  it("falls back from imdbid+season+ep to q+season+ep when first path is empty", async () => {
    const fallbackItem = `<rss><channel><item>
      <title>Fallback.2026.1080p.WEB-DL</title>
      <guid>magnet:?xt=urn:btih:FEDCBA9876543210FEDCBA9876543210FEDCBA98</guid>
      <size>200</size>
    </item></channel></rss>`;
    const mock = makeMockFetch((_, hit) => {
      if (hit === 1) return ok("<rss><channel></channel></rss>");
      return ok(fallbackItem);
    });

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("tt1234567", "series", 2, 5);

    expect(results).toHaveLength(1);
    expect(mock.hits()).toBe(2);
    const calls = mock.history().map((value) => new URL(value));
    expect(calls[0].searchParams.get("imdbid")).toBe("tt1234567");
    expect(calls[0].searchParams.get("season")).toBe("2");
    expect(calls[0].searchParams.get("ep")).toBe("5");
    expect(calls[1].searchParams.get("q")).toBe("tt1234567");
    expect(calls[1].searchParams.get("season")).toBe("2");
    expect(calls[1].searchParams.get("ep")).toBe("5");
  });

  it("falls back from uppercase TT-prefixed imdbid to numeric id", async () => {
    const fallbackItem = `<rss><channel><item>
      <title>Uppercase.TT.Fallback.1080p.WEB-DL</title>
      <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
      <size>220</size>
      <torznab:attr name="seeders" value="11"/>
    </item></channel></rss>`;

    const mock = makeMockFetch((url) => {
      const u = new URL(url);
      const isTT = u.searchParams.get("imdbid") === "TT1234567" || u.searchParams.get("q") === "TT1234567";
      const isNumeric = u.searchParams.get("imdbid") === "1234567" || u.searchParams.get("q") === "1234567";

      if (isTT && !isNumeric) {
        return ok("<rss><channel></channel></rss>");
      }
      if (isNumeric) {
        return ok(fallbackItem);
      }
      return ok("<rss><channel></channel></rss>");
    });

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("TT1234567", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(mock.hits()).toBe(3);
    expect(results[0]?.infoHash).toBe(
      "1111111111111111111111111111111111111111",
    );
  });

  it("does not fallback when the imdb ID is already numeric", async () => {
    const mock = makeMockFetch(() =>
      ok(
        `<rss><channel><item>
          <title>Numeric.Fallback.Found</title>
          <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
          <size>210</size>
        </item></channel></rss>`,
      ),
    );

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("1234", "movie", null, null);

    const calls = mock.history().map((value) => new URL(value));
    expect(results).toHaveLength(1);
    expect(mock.hits()).toBe(1);
    expect(calls[0].searchParams.get("imdbid")).toBe("1234");
    expect(calls[0].searchParams.has("q")).toBe(false);
  });

  it("does not create a numeric fallback for bare 'tt' IMDb IDs", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });

    const results = await indexer.search("tt", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(2);
    const calls = mock.history().map((value) => new URL(value));
    expect(calls.map((u) => u.searchParams.get("imdbid") ?? u.searchParams.get("q"))).toEqual(["tt", "tt"]);
  });

  it("falls back to numeric imdb IDs when tt-prefixed IDs return empty", async () => {
    const numericBody = `<rss><channel><item>
      <title>Numeric.Fallback.Movie</title>
      <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
      <size>140</size>
    </item></channel></rss>`;

    const mock = makeMockFetch((url) => {
      const u = new URL(url);
      const isTT = u.searchParams.get("imdbid") === "tt1234567" || u.searchParams.get("q") === "tt1234567";
      const isNumeric = u.searchParams.get("imdbid") === "1234567" || u.searchParams.get("q") === "1234567";

      if (isTT && !isNumeric) {
        return ok("<rss><channel></channel></rss>");
      }
      if (isNumeric) {
        return ok(numericBody);
      }

      return ok("<rss><channel></channel></rss>");
    });

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("tt1234567", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe("1111111111111111111111111111111111111111");
    expect(mock.hits()).toBe(3);
  });

  it("falls back to imdbid-only and q-only paths for movie searches when needed", async () => {
    const fallbackItem = `<rss><channel><item>
      <title>Movie.Fallback.1080p.WEB-DL</title>
      <guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>
      <size>300</size>
    </item></channel></rss>`;
    const mock = makeMockFetch((_, hit) => {
      if (hit === 1) return ok("<rss><channel></channel></rss>");
      return ok(fallbackItem);
    });

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("tt9876543", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(mock.hits()).toBe(2);
    const calls = mock.history().map((value) => new URL(value));
    expect(calls[0].searchParams.get("imdbid")).toBe("tt9876543");
    expect(calls[0].searchParams.has("q")).toBe(false);
    expect(calls[1].searchParams.get("q")).toBe("tt9876543");
    expect(calls[1].searchParams.has("imdbid")).toBe(false);
  });

  it("continues through fallback attempts when the first search request errors", async () => {
    const fallbackItem = `<rss><channel><item>
      <title>Recovered.Fallback</title>
      <guid>magnet:?xt=urn:btih:2222222222222222222222222222222222222222</guid>
      <size>400</size>
    </item></channel></rss>`;
    const mock = makeMockFetch((_, hit) => {
      if (hit === 1) return { status: 502, body: "broken" };
      return ok(fallbackItem);
    });

    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.search("tt500", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(mock.hits()).toBe(2);
  });

  it("uses default fetch when not provided", async () => {
    const localFetch = vi.fn(async () => ({
      status: 200,
      text: async () => "<rss><channel></channel></rss>",
    }));
    vi.stubGlobal("fetch", localFetch);
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "/api",
    });
    await indexer.searchByQuery("test", "movie");
    expect(localFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns [] without touching the network when imdb id is blank", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });

    const results = await indexer.search("   ", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("returns [] when all fallback attempts are successful but empty", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });

    const results = await indexer.search("ttNoResults", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(4);
  });

  it("throws when all fallback attempts fail", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "server down" }));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });

    await expect(indexer.search("ttFail", "movie", null, null)).rejects.toMatchObject(
      { kind: "badServerResponse" },
    );
    expect(mock.hits()).toBe(4);
  });
});

describe("TorznabIndexer: category (cat) mapping & apikey", () => {
  it("appends the categoryFilter as the cat query param", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      categoryFilter: "2000,5000",
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.get("cat")).toBe("2000,5000");
  });

  it("omits cat when categoryFilter is null", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      categoryFilter: null,
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.has("cat")).toBe(false);
  });

  it("omits cat when categoryFilter is an empty string", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      categoryFilter: "",
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.has("cat")).toBe(false);
  });

  it("sends apikey in the query by default and no header", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      apiKey: "abc123",
      sendAPIKeyAsHeader: false,
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.get("apikey")).toBe("abc123");
    expect(mock.lastHeaders()).toBeUndefined();
  });

  it("sends the X-Api-Key header (and NOT the query apikey) in header mode", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      apiKey: "header-token",
      sendAPIKeyAsHeader: true,
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastHeaders()?.["X-Api-Key"]).toBe("header-token");
    expect(mock.lastURL()!.searchParams.get("apikey")).toBeNull();
  });

  it("omits apikey entirely when no key is configured (no header passed)", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl, apiKey: null });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.has("apikey")).toBe(false);
    expect(mock.lastHeaders()).toBeUndefined();
  });

  it("an empty-string apikey is treated as no key (header mode does not set header)", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({
      fetchImpl: mock.fetchImpl,
      apiKey: "",
      sendAPIKeyAsHeader: true,
    });
    await indexer.searchByQuery("x", "movie");
    expect(mock.lastURL()!.searchParams.has("apikey")).toBe(false);
    expect(mock.lastHeaders()).toBeUndefined();
  });
});

describe("TorznabIndexer: response handling", () => {
  it("throws badServerResponse on a non-2xx status", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "server error" }));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    await expect(indexer.searchByQuery("x", "movie")).rejects.toMatchObject({
      kind: "badServerResponse",
      statusCode: 500,
    });
  });

  it("treats 299 as success and 300 as failure (2xx boundary)", async () => {
    const ok299 = makeMockFetch(() => ({
      status: 299,
      body: "<rss><channel></channel></rss>",
    }));
    await expect(
      makeIndexer({ fetchImpl: ok299.fetchImpl }).searchByQuery("x", "movie"),
    ).resolves.toEqual([]);

    const fail300 = makeMockFetch(() => ({ status: 300, body: "<rss/>" }));
    await expect(
      makeIndexer({ fetchImpl: fail300.fetchImpl }).searchByQuery("x", "movie"),
    ).rejects.toMatchObject({ kind: "badServerResponse" });
  });

  it("maps a parsed item to a TorrentResult (lowercased hash, magnet passthrough)", async () => {
    const xml = `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
  <item>
    <title>Example.Movie.2026.1080p.WEB-DL</title>
    <guid>magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12</guid>
    <size>1500000000</size>
    <torznab:attr name="seeders" value="123"/>
    <torznab:attr name="peers" value="4"/>
    <torznab:attr name="infohash" value="ABCDEF1234567890ABCDEF1234567890ABCDEF12"/>
  </item>
</channel></rss>`;
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl, name: "Jackett" });
    const results = await indexer.searchByQuery("Example", "movie");
    expect(results.length).toBe(1);
    const r = results[0]!;
    expect(r.infoHash).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(r.title).toBe("Example.Movie.2026.1080p.WEB-DL");
    expect(r.sizeBytes).toBe(1_500_000_000);
    expect(r.seeders).toBe(123);
    expect(r.leechers).toBe(4);
    expect(r.indexerName).toBe("Jackett");
    expect(r.magnetURI).toBe(
      "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    );
  });

  it("falls back to the magnet xt=urn:btih hash when no infohash attr is present", async () => {
    const xml =
      "<rss><channel><item>" +
      "<title>No.Infohash.Attr.1080p</title>" +
      "<link>magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=x</link>" +
      '<torznab:attr name="seeders" value="9"/>' +
      '<torznab:attr name="size" value="42"/>' +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl, endpointPath: "" });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(results[0]?.seeders).toBe(9);
    expect(results[0]?.sizeBytes).toBe(42);
  });

  it("prefers the explicit infohash attr over the magnet-derived hash", async () => {
    const xml =
      "<rss><channel><item>" +
      "<title>Both</title>" +
      "<link>magnet:?xt=urn:btih:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF</link>" +
      '<torznab:attr name="infohash" value="ABCDEF1234567890ABCDEF1234567890ABCDEF12"/>' +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results[0]?.infoHash).toBe(
      "abcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("drops items with no infohash and no resolvable magnet hash", async () => {
    const xml =
      "<rss><channel>" +
      "<item><title>Has hash</title>" +
      '<torznab:attr name="infohash" value="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"/></item>' +
      "<item><title>No hash, http link</title>" +
      "<link>https://tracker/download/1.torrent</link></item>" +
      "<item><title>Magnet but no btih</title>" +
      "<link>magnet:?dn=onlyname&tr=udp://x</link></item>" +
      "</channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("drops an item whose infohash attr is an empty string", async () => {
    const xml =
      "<rss><channel><item><title>EmptyHash</title>" +
      '<torznab:attr name="infohash" value=""/></item></channel></rss>';
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results).toEqual([]);
  });

  it("drops a malformed torznab:attr magnet URL that cannot be parsed", async () => {
    const xml =
      "<rss xmlns:torznab=\"x\"><channel><item>" +
      "<title>Malformed Magnet</title>" +
      '<torznab:attr name="magneturl" value="not a url"/>' +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results).toEqual([]);
  });

  it("drops a valid magnet URL without btih as hash seed", async () => {
    const xml =
      "<rss><channel><item><title>NoBtih</title>" +
      "<link>magnet:?dn=movie-only-name</link>" +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results).toEqual([]);
  });

  it("drops a valid magnet URL with an unsupported hash scheme", async () => {
    const xml =
      "<rss><channel><item><title>SHA1Only</title>" +
      "<link>magnet:?xt=urn:sha1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</link>" +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results).toEqual([]);
  });

  it("returns [] for an empty feed (HTTP 200)", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results).toEqual([]);
  });

  it("extracts the hash from xt with a mixed-case 'urn:btih:' prefix (case-insensitive)", async () => {
    const xml =
      "<rss><channel><item><title>MixedScheme</title>" +
      "<link>magnet:?xt=URN:BTIH:abcDEF1234567890abcDEF1234567890abcDEF12</link>" +
      "</item></channel></rss>";
    const mock = makeMockFetch(() => ok(xml));
    const indexer = makeIndexer({ fetchImpl: mock.fetchImpl });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results.length).toBe(1);
    // The prefix match is case-insensitive but the hash slice keeps the original
    // case from after the prefix; fromSearch then lowercases it.
    expect(results[0]?.infoHash).toBe(
      "abcdef1234567890abcdef1234567890abcdef12",
    );
  });
});
