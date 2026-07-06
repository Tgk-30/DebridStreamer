// Extra tests for hashlist decode — targets the per-error throw branches that
// the round-trip happy-path tests don't reach: invalid JSON, missing/non-array
// items, over-MAX_ITEMS, and an all-invalid-hash payload. We hand-craft the
// `dshl1:` wire string (gzip(deflate) -> base64url) so we control the inner JSON
// rather than only producing well-formed lists via encodeHashList.

import { describe, expect, it } from "vitest";
import { deflate } from "pako";
import { decodeHashList } from "./hashlist";

const PREFIX = "dshl1:";
const HASH_A = "0123456789abcdef0123456789abcdef01234567";

/** Mirror the module's bytes->base64url so we can wrap arbitrary inner bytes. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Wrap a raw string as a `dshl1:` payload (deflate -> base64url). Lets us inject
 * non-JSON or non-conforming JSON that encodeHashList would never emit. */
function wrapRaw(inner: string): string {
  return PREFIX + bytesToBase64Url(deflate(new TextEncoder().encode(inner)));
}

describe("decodeHashList — payload-shape error branches", () => {
  it("throws on a payload that inflates to invalid JSON", () => {
    expect(() => decodeHashList(wrapRaw("this is not json {"))).toThrow(
      /not valid JSON/i,
    );
  });

  it("throws when the parsed payload has no items array (missing items)", () => {
    expect(() => decodeHashList(wrapRaw(JSON.stringify({ v: 1 })))).toThrow(
      /no items/i,
    );
  });

  it("throws when items is present but not an array", () => {
    expect(() =>
      decodeHashList(wrapRaw(JSON.stringify({ v: 1, items: "nope" }))),
    ).toThrow(/no items/i);
  });

  it("throws when the payload is JSON null (no items)", () => {
    expect(() => decodeHashList(wrapRaw("null"))).toThrow(/no items/i);
  });

  it("throws when items exceeds MAX_ITEMS (10_000)", () => {
    const items = Array.from({ length: 10_001 }, () => ({ h: HASH_A }));
    expect(() =>
      decodeHashList(wrapRaw(JSON.stringify({ v: 1, items }))),
    ).toThrow(/too many entries/i);
  });

  it("throws when every item is an invalid/non-string hash (no valid infoHashes)", () => {
    const items = [
      { h: "not-a-hash" },
      { h: 12345 }, // non-string h is filtered out before normalize
      { n: "name-only" }, // missing h
      null, // null entry filtered out
    ];
    expect(() =>
      decodeHashList(wrapRaw(JSON.stringify({ v: 1, items }))),
    ).toThrow(/no valid infoHashes/i);
  });

  it("decodes a payload mixing valid + invalid items, keeping only the valid one", () => {
    const items = [{ h: "garbage" }, { h: HASH_A, n: "Keeper" }, null];
    const out = decodeHashList(wrapRaw(JSON.stringify({ v: 1, items })));
    expect(out).toEqual([{ infoHash: HASH_A, name: "Keeper" }]);
  });
});

describe("decodeHashList — bounded inflate (decompression bomb)", () => {
  it("aborts when the inflated output exceeds MAX_INFLATED_BYTES (4 MiB)", () => {
    // A long run of one character compresses tiny but inflates huge. >4 MiB of
    // 'a' deflates to a few hundred base64url chars — well under the compressed
    // cap — so it slips past that guard and must be stopped mid-inflate instead.
    const bomb = "a".repeat(5 * 1024 * 1024);
    const encoded = wrapRaw(bomb);
    expect(encoded.length).toBeLessThan(256 * 1024 + "dshl1:".length);
    expect(() => decodeHashList(encoded)).toThrow(/corrupted or not decodable/i);
  }, 15000);
});
