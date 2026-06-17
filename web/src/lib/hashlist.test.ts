// Tests for the hash-list encode/decode + parsing helpers.

import { describe, expect, it } from "vitest";
import {
  encodeHashList,
  decodeHashList,
  normalizeInfoHash,
  normalizeEntries,
  parseHashListInput,
  type HashListEntry,
} from "./hashlist";

const HASH_A = "0123456789abcdef0123456789abcdef01234567";
const HASH_B = "fedcba9876543210fedcba9876543210fedcba98";

describe("normalizeInfoHash", () => {
  it("lowercases and accepts a valid 40-hex hash", () => {
    expect(normalizeInfoHash(HASH_A.toUpperCase())).toBe(HASH_A);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeInfoHash(`  ${HASH_A}  `)).toBe(HASH_A);
  });

  it("rejects non-40-char or non-hex strings", () => {
    expect(normalizeInfoHash("nothex")).toBeNull();
    expect(normalizeInfoHash("0123")).toBeNull();
    expect(normalizeInfoHash(`${HASH_A}gg`)).toBeNull();
  });
});

describe("normalizeEntries", () => {
  it("dedupes by hash (first name wins) and drops invalid", () => {
    const entries: HashListEntry[] = [
      { infoHash: HASH_A.toUpperCase(), name: "First" },
      { infoHash: HASH_A, name: "Second" },
      { infoHash: "bad" },
      { infoHash: HASH_B },
    ];
    const out = normalizeEntries(entries);
    expect(out).toEqual([
      { infoHash: HASH_A, name: "First" },
      { infoHash: HASH_B, name: null },
    ]);
  });
});

describe("encode/decode round-trip", () => {
  it("round-trips a list with names", () => {
    const entries: HashListEntry[] = [
      { infoHash: HASH_A, name: "Movie A" },
      { infoHash: HASH_B, name: "Movie B" },
    ];
    const encoded = encodeHashList(entries);
    expect(encoded.startsWith("dshl1:")).toBe(true);
    expect(decodeHashList(encoded)).toEqual(entries);
  });

  it("round-trips a list without names (null)", () => {
    const encoded = encodeHashList([{ infoHash: HASH_A }]);
    expect(decodeHashList(encoded)).toEqual([{ infoHash: HASH_A, name: null }]);
  });

  it("produces a URL-safe string (no +, /, or = padding)", () => {
    const encoded = encodeHashList([
      { infoHash: HASH_A, name: "name with spaces & symbols!" },
      { infoHash: HASH_B },
    ]);
    const payload = encoded.slice("dshl1:".length);
    expect(payload).not.toMatch(/[+/=]/);
    expect(decodeHashList(encoded)[0].name).toBe("name with spaces & symbols!");
  });
});

describe("decodeHashList errors", () => {
  it("throws on a string without the prefix", () => {
    expect(() => decodeHashList("not-a-hash-list")).toThrow();
  });

  it("throws on a corrupted payload", () => {
    expect(() => decodeHashList("dshl1:###notbase64###")).toThrow();
  });
});

describe("parseHashListInput", () => {
  it("decodes a dshl1 string", () => {
    const encoded = encodeHashList([{ infoHash: HASH_A, name: "A" }]);
    expect(parseHashListInput(encoded)).toEqual([{ infoHash: HASH_A, name: "A" }]);
  });

  it("falls back to scanning raw hashes from free text", () => {
    const text = `Here are some:\n${HASH_A}\nand ${HASH_B} too`;
    expect(parseHashListInput(text)).toEqual([
      { infoHash: HASH_A, name: null },
      { infoHash: HASH_B, name: null },
    ]);
  });

  it("returns [] for empty / hashless input", () => {
    expect(parseHashListInput("")).toEqual([]);
    expect(parseHashListInput("no hashes here")).toEqual([]);
  });

  it("returns [] for a malformed dshl1 string rather than throwing", () => {
    expect(parseHashListInput("dshl1:garbage")).toEqual([]);
  });
});
