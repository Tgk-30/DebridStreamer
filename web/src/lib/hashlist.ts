// Hash-list import/share — a compact, shareable encoding of a set of torrent
// infoHashes (+ optional names) so a user can hand another user (or themselves
// on another machine) a single string that bulk-hydrates onto their debrid.
//
// Wire format: JSON -> gzip(pako) -> base64url, prefixed with a short version
// tag ("dshl1:") so the decoder can reject unrelated strings and we can evolve
// the format later. The JSON payload is `{ v: 1, items: [{ h, n? }, ...] }`
// where `h` is a lowercased 40-char hex infoHash and `n` is an optional name.
//
// Everything here is PURE (no network, no Tauri) so it unit-tests directly and
// runs in both the browser and the desktop webview. base64url (RFC 4648 §5) is
// used so the string is URL/clipboard-safe without padding.

import { deflate, inflate } from "pako";

/** One entry in a hash-list: an infoHash plus an optional display name. */
export interface HashListEntry {
  infoHash: string;
  name?: string | null;
}

/** The current wire-format version tag prefix. */
const PREFIX = "dshl1:";

/** Raw JSON payload shape (compact field names to keep the encoded string small). */
interface RawPayload {
  v: number;
  items: { h: string; n?: string }[];
}

/** A 40-hex-char SHA-1 infoHash (the canonical BitTorrent v1 form). */
const HASH_RE = /^[0-9a-f]{40}$/;

/** Lowercase + trim a candidate infoHash; returns null when it isn't a valid
 * 40-hex-char hash. Tolerates uppercase and surrounding whitespace. */
export function normalizeInfoHash(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  return HASH_RE.test(h) ? h : null;
}

/** Dedupe entries by infoHash (first occurrence wins, keeping its name) and drop
 * invalid hashes. The returned list is safe to encode. */
export function normalizeEntries(entries: HashListEntry[]): HashListEntry[] {
  const seen = new Set<string>();
  const out: HashListEntry[] = [];
  for (const e of entries) {
    const h = normalizeInfoHash(e.infoHash);
    if (h == null || seen.has(h)) continue;
    seen.add(h);
    const name = e.name?.trim();
    out.push({ infoHash: h, name: name && name.length > 0 ? name : null });
  }
  return out;
}

/** Encode a list of {infoHash, name?} to a compact shareable string
 * (`dshl1:<base64url(gzip(json))>`). Invalid/duplicate hashes are dropped. */
export function encodeHashList(entries: HashListEntry[]): string {
  const normalized = normalizeEntries(entries);
  const payload: RawPayload = {
    v: 1,
    items: normalized.map((e) =>
      e.name ? { h: e.infoHash, n: e.name } : { h: e.infoHash },
    ),
  };
  const json = JSON.stringify(payload);
  const gz = deflate(textToBytes(json));
  return PREFIX + bytesToBase64Url(gz);
}

/** Decode a shareable string back into a list of entries. Throws on a string
 * that isn't a well-formed hash-list (wrong prefix, undecodable, or no valid
 * hashes), so callers can show a clear "not a hash list" error. */
export function decodeHashList(encoded: string): HashListEntry[] {
  const trimmed = encoded.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("Not a DebridStreamer hash list.");
  }
  const b64 = trimmed.slice(PREFIX.length);
  let json: string;
  try {
    const gz = base64UrlToBytes(b64);
    json = bytesToText(inflate(gz));
  } catch {
    throw new Error("Hash list is corrupted or not decodable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Hash list payload is not valid JSON.");
  }
  const items = (parsed as RawPayload | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error("Hash list payload has no items.");
  }
  const entries = normalizeEntries(
    items
      .filter((i): i is { h: string; n?: string } => i != null && typeof i.h === "string")
      .map((i) => ({ infoHash: i.h, name: typeof i.n === "string" ? i.n : null })),
  );
  if (entries.length === 0) {
    throw new Error("Hash list contains no valid infoHashes.");
  }
  return entries;
}

/** Best-effort parse of free-text pasted input into entries: first tries the
 * compact `dshl1:` format, then falls back to scanning the text for raw 40-hex
 * infoHashes (one per line / whitespace-separated). Returns [] when nothing
 * usable is found (never throws — the dialog drives the error copy). */
export function parseHashListInput(input: string): HashListEntry[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith(PREFIX)) {
    try {
      return decodeHashList(trimmed);
    } catch {
      return [];
    }
  }
  // Fallback: pull every 40-hex token out of the raw text.
  const matches = trimmed.match(/[0-9a-fA-F]{40}/g) ?? [];
  return normalizeEntries(matches.map((h) => ({ infoHash: h })));
}

// ---- base64url + text codecs (browser + jsdom + tauri webview safe) ---------
// TextEncoder/TextDecoder + btoa/atob are present in the browser, the Tauri
// webview, and the jsdom/node test environment, so no node `Buffer` fallback is
// needed (and adding one would pull in @types/node, which this web build omits).

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Standard base64 of a byte array via `btoa`. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad to a multiple of 4 so atob/Buffer accept it.
  while (b64.length % 4 !== 0) b64 += "=";
  return base64ToBytes(b64);
}
