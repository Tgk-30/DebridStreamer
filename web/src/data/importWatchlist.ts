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

type ImportFormat = "imdb" | "letterboxd" | "catalog" | "plain";

/** The parse result retains source and row-quality information so the import UI
 * can create a meaningful folder and report rows it safely skipped. */
interface WatchlistImportParse {
  entries: ImportEntry[];
  format: ImportFormat;
  folderName: string | null;
  skippedRows: number;
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

function firstHeaderIndex(header: string[], names: string[]): number {
  for (const name of names) {
    const index = headerIndex(header, name);
    if (index >= 0) return index;
  }
  return -1;
}

function parseCsvRows(text: string): { rows: string[][]; malformedRows: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let malformedRows = 0;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) {
    // An unmatched quote consumes the final record. Do not guess at its fields:
    // skip it and make the count visible to the user instead.
    malformedRows += 1;
  } else {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }
  return { rows, malformedRows };
}

function folderNameFromFile(
  fileName: string | null | undefined,
  fallback: string,
): string {
  const base = (fileName ?? "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base.length > 0 ? base : fallback;
}

function sourceFolderName(
  header: string[],
  rows: string[][],
  fileName: string | null | undefined,
  fallback: string,
): string {
  const listIndex = firstHeaderIndex(header, ["List", "List Name", "Collection"]);
  const rowName = listIndex >= 0 ? rows.find((row) => row[listIndex]?.trim())?.[listIndex]?.trim() : "";
  return rowName && rowName.length > 0 ? rowName : folderNameFromFile(fileName, fallback);
}

/** Parse import text into entries, auto-detecting the format. */
export function parseImportEntries(text: string): ImportEntry[] {
  return parseWatchlistImport(text).entries;
}

/** Parse standard IMDb, Letterboxd, and conventional catalog CSV exports.
 * Plain pasted title lists stay supported but do not create folders. */
export function parseWatchlistImport(
  text: string,
  fileName?: string | null,
): WatchlistImportParse {
  const { rows, malformedRows } = parseCsvRows(text);
  if (rows.length === 0) {
    return { entries: [], format: "plain", folderName: null, skippedRows: malformedRows };
  }

  const header = rows[0]!.map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const looksImdb = lower.includes("const") || lower.includes("title type");
  const looksLetterboxd =
    lower.some((h) => h.includes("letterboxd uri")) ||
    (lower.includes("name") && lower.includes("year"));
  const titleIndex = firstHeaderIndex(header, ["Title", "Name", "Title Name"]);
  const looksCatalog = titleIndex >= 0;

  if (looksImdb) {
    const ti = headerIndex(header, "Title");
    const yi = firstHeaderIndex(header, ["Year", "Release Year", "Release Date"]);
    const tt = firstHeaderIndex(header, ["Title Type", "Type", "Media Type"]);
    const parsed = rowsToEntries(rows.slice(1), (cols) => ({
      title: (cols[ti] ?? "").trim(),
      year: parseYear(cols[yi]),
      type: imdbTitleType(cols[tt]),
    }));
    return {
      entries: parsed.entries,
      format: "imdb",
      folderName: sourceFolderName(header, rows.slice(1), fileName, "IMDb import"),
      skippedRows: malformedRows + parsed.skippedRows,
    };
  }
  if (looksLetterboxd) {
    const ni = headerIndex(header, "Name");
    const yi = firstHeaderIndex(header, ["Year", "Release Year", "Release Date"]);
    const parsed = rowsToEntries(rows.slice(1), (cols) => ({
      title: (cols[ni] ?? "").trim(),
      year: parseYear(cols[yi]),
      type: null,
    }));
    return {
      entries: parsed.entries,
      format: "letterboxd",
      folderName: sourceFolderName(header, rows.slice(1), fileName, "Letterboxd import"),
      skippedRows: malformedRows + parsed.skippedRows,
    };
  }
  if (looksCatalog) {
    const yi = firstHeaderIndex(header, ["Year", "Release Year", "Release Date", "Date"]);
    const typeIndex = firstHeaderIndex(header, ["Title Type", "Type", "Media Type", "Kind"]);
    const parsed = rowsToEntries(rows.slice(1), (cols) => ({
      title: (cols[titleIndex] ?? "").trim(),
      year: parseYear(cols[yi]),
      type: imdbTitleType(cols[typeIndex]),
    }));
    return {
      entries: parsed.entries,
      format: "catalog",
      folderName: sourceFolderName(header, rows.slice(1), fileName, "Imported list"),
      skippedRows: malformedRows + parsed.skippedRows,
    };
  }

  // Plain list: "Title (1999)", "Title, 1999", or bare "Title".
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    entries: dedupeEntries(
      lines
      .map((line) => plainLineToEntry(line))
      .filter((e): e is ImportEntry => e != null),
    ),
    format: "plain",
    folderName: null,
    skippedRows: malformedRows,
  };
}

function rowsToEntries(
  rows: string[][],
  map: (cols: string[]) => ImportEntry,
): { entries: ImportEntry[]; skippedRows: number } {
  const seen = new Set<string>();
  const out: ImportEntry[] = [];
  let skippedRows = 0;
  for (const row of rows) {
    const entry = map(row);
    if (entry.title.length === 0) {
      skippedRows += 1;
      continue;
    }
    const key = dedupeKey(entry);
    if (seen.has(key)) {
      skippedRows += 1;
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return { entries: out, skippedRows };
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
