// Bulk watchlist import - pure parsing + match logic.
//
// Accepts three shapes and normalises them to ImportEntry rows:
//   • IMDb CSV export     (header has a "Title Type" / "Const" column)
//   • Letterboxd CSV export (header has a "Letterboxd URI" column)
//   • a plain pasted list  ("Title (Year)" / "Title, Year" / "Title" per line)
// Each entry is later resolved to a real MediaPreview via TMDB search (see
// resolveEntry). Kept dependency-free so it's fully unit-testable.

import type { MediaPreview, MediaType } from "../models/media";

export interface ImportEntry {
  title: string;
  year: number | null;
  /** Preferred media type when the source tells us (IMDb "Title Type"); else
   *  null (search across both). */
  type: MediaType | null;
}

/** Split one CSV line into fields, honouring double-quoted fields (which may
 * contain commas and escaped `""` quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

function parseYear(raw: string | undefined): number | null {
  if (raw == null) return null;
  const m = raw.match(/\d{4}/);
  if (m == null) return null;
  const y = Number(m[0]);
  return y >= 1870 && y <= 2100 ? y : null;
}

/** IMDb "Title Type" → our MediaType (best effort; null = leave unfiltered). */
function imdbTitleType(raw: string | undefined): MediaType | null {
  if (raw == null) return null;
  const t = raw.toLowerCase();
  if (t.includes("series") || t.includes("episode") || t.includes("miniseries")) {
    return "series";
  }
  if (t.includes("movie") || t === "video" || t === "short" || t === "tvmovie") {
    return "movie";
  }
  return null;
}

function headerIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/** Parse import text into entries, auto-detecting the format. */
export function parseImportEntries(text: string): ImportEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const looksImdb =
    lower.includes("const") || lower.includes("title type");
  const looksLetterboxd =
    lower.some((h) => h.includes("letterboxd uri")) ||
    (lower.includes("name") && lower.includes("year"));

  if (looksImdb) {
    const ti = headerIndex(header, "Title");
    const yi = headerIndex(header, "Year");
    const tt = headerIndex(header, "Title Type");
    return rowsToEntries(lines.slice(1), (cols) => ({
      title: (cols[ti] ?? "").trim(),
      year: parseYear(cols[yi]),
      type: imdbTitleType(cols[tt]),
    }));
  }
  if (looksLetterboxd) {
    const ni = headerIndex(header, "Name");
    const yi = headerIndex(header, "Year");
    return rowsToEntries(lines.slice(1), (cols) => ({
      title: (cols[ni] ?? "").trim(),
      year: parseYear(cols[yi]),
      type: null,
    }));
  }

  // Plain list: "Title (1999)", "Title, 1999", or bare "Title".
  return dedupeEntries(
    lines
      .map((line) => plainLineToEntry(line))
      .filter((e): e is ImportEntry => e != null),
  );
}

function rowsToEntries(
  rows: string[],
  map: (cols: string[]) => ImportEntry,
): ImportEntry[] {
  const seen = new Set<string>();
  const out: ImportEntry[] = [];
  for (const row of rows) {
    const entry = map(parseCsvLine(row));
    if (entry.title.length === 0) continue;
    const key = dedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function plainLineToEntry(line: string): ImportEntry | null {
  // "Title (1999)" or "Title [1999]"
  const paren = line.match(/^(.*?)[([](\d{4})[)\]]\s*$/);
  if (paren != null) {
    return { title: paren[1].trim(), year: Number(paren[2]), type: null };
  }
  // "Title, 1999" (trailing year after a comma)
  const comma = line.match(/^(.*),\s*(\d{4})\s*$/);
  if (comma != null) {
    return { title: comma[1].trim(), year: Number(comma[2]), type: null };
  }
  if (line.length === 0) return null;
  return { title: line, year: null, type: null };
}

function dedupeKey(e: ImportEntry): string {
  return `${e.title.toLowerCase()}|${e.year ?? ""}`;
}

/** De-duplicate a list of already-parsed entries by title+year. */
export function dedupeEntries(entries: ImportEntry[]): ImportEntry[] {
  const seen = new Set<string>();
  const out: ImportEntry[] = [];
  for (const e of entries) {
    const key = dedupeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Pick the best TMDB candidate for an entry: exact title + exact year + type
 * match score highest; falls back to the first (most-relevant) result. Returns
 * null only when there are no candidates. */
export function pickBestMatch(
  entry: ImportEntry,
  candidates: MediaPreview[],
): MediaPreview | null {
  if (candidates.length === 0) return null;
  const wantTitle = entry.title.trim().toLowerCase();
  let best: MediaPreview | null = null;
  let bestScore = -Infinity;
  candidates.forEach((c, i) => {
    let score = 0;
    if (c.title.trim().toLowerCase() === wantTitle) score += 3;
    if (entry.type != null && c.type === entry.type) score += 1;
    if (entry.year != null && c.year != null) {
      if (c.year === entry.year) score += 3;
      else if (Math.abs(c.year - entry.year) <= 1) score += 1;
    }
    // Preserve TMDB relevance order on ties (earlier = better).
    score -= i * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  return best;
}

/** Resolve one entry to a MediaPreview via an injected search function (TMDB in
 * Local Mode, the server in Server Mode). Returns null when nothing matches. */
export async function resolveEntry(
  entry: ImportEntry,
  search: (query: string, type: MediaType | null) => Promise<MediaPreview[]>,
): Promise<MediaPreview | null> {
  const candidates = await search(entry.title, entry.type);
  return pickBestMatch(entry, candidates);
}
