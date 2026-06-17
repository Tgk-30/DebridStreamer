// Port of Sources/DebridStreamer/Services/Sync/IMDbCSVSyncService.swift.
//
// Ports the PURE HTTP-free CSV logic: the RFC-4180-ish CSV parser/serializer,
// `normalizedSlug`, `parseCSV`, `exportCSV(mediaItems:)`, and the synthesized
// fallback media-id rule used during import. The two `importCSV(...)` and
// `exportCSV(database:)`/`exportCSVAllFolders(...)` methods are DB-backed
// (they take a `DatabaseManager` and read/write rows); that DB layer is not yet
// ported to web, so those orchestration methods are intentionally OMITTED here.
// The id-synthesis the importer relies on is exposed as `fallbackMediaID` so
// the dedup-key logic is unit-tested independently of the DB.

import type { MediaItem } from "../../models/media";
import type { IMDbCSVEntry, ListType } from "./models";

export class IMDbCSVSyncService {
  /**
   * Builds a stable, diacritic/case-insensitive slug from a title for use as a
   * synthesized media id when no IMDb const is present. Collapses runs of
   * non-alphanumeric characters to single hyphens and strips diacritics, so the
   * raw title text never leaks into the id and casing/accents don't fork ids.
   * Mirrors Swift `normalizedSlug`.
   */
  normalizedSlug(s: string): string {
    // NFD + strip combining marks == Swift's `.diacriticInsensitive` folding.
    const deaccented = s.normalize("NFD").replace(/\p{M}/gu, "");
    return deaccented
      .toLowerCase()
      // Split on any run of non-alphanumerics (Swift:
      // CharacterSet.alphanumerics.inverted). \p{L}\p{N} keeps Unicode letters/
      // digits, matching Swift's Unicode-aware alphanumerics.
      .split(/[^\p{L}\p{N}]+/u)
      .filter((part) => part.length > 0)
      .join("-");
  }

  /**
   * Synthesized media id for a parsed entry: the IMDb const when present, else
   * `imdb-{slug}-{year}` (year defaults to 0). Mirrors the per-row id the Swift
   * `importCSV` computes for dedup/insert. Pure so the dedup key is testable
   * without a DB.
   */
  fallbackMediaID(entry: IMDbCSVEntry): string {
    if (entry.imdbID != null) return entry.imdbID;
    return `imdb-${this.normalizedSlug(entry.title)}-${entry.year ?? 0}`;
  }

  /**
   * Parses an IMDb-style CSV into entries. Reads the `Const`/`Title`/`Year`
   * columns case-insensitively from the header, skips rows with an empty title,
   * and trims cells. Mirrors Swift `parseCSV`.
   */
  parseCSV(contents: string, listType: ListType): IMDbCSVEntry[] {
    const rows = CSVParser.parse(contents);
    const header = rows[0];
    if (header == null) return [];

    const headerIndex = new Map<string, number>();
    header.forEach((name, index) => {
      headerIndex.set(name.toLowerCase(), index);
    });

    const idxConst = headerIndex.get("const");
    const idxTitle = headerIndex.get("title");
    const idxYear = headerIndex.get("year");

    const entries: IMDbCSVEntry[] = [];
    for (const row of rows.slice(1)) {
      if (idxTitle == null || idxTitle >= row.length) continue;
      const title = row[idxTitle].trim();
      if (title.length === 0) continue;

      let imdbID: string | null = null;
      if (idxConst != null && idxConst < row.length) {
        const value = row[idxConst].trim();
        imdbID = value.length === 0 ? null : value;
      }

      let year: number | null = null;
      if (idxYear != null && idxYear < row.length) {
        const parsed = Number.parseInt(row[idxYear].trim(), 10);
        // Swift `Int(_:)` rejects trailing junk; mirror that with a strict check.
        year = /^[+-]?\d+$/.test(row[idxYear].trim()) && !Number.isNaN(parsed)
          ? parsed
          : null;
      }

      entries.push({ imdbID, title, year, listType });
    }
    return entries;
  }

  /**
   * Serializes media items into an IMDb-compatible CSV with a
   * `Const,Title,Year` header. Mirrors Swift `exportCSV(mediaItems:)`.
   */
  exportCSV(mediaItems: MediaItem[]): string {
    const rows: string[][] = [["Const", "Title", "Year"]];
    for (const item of mediaItems) {
      rows.push([item.id, item.title, item.year != null ? String(item.year) : ""]);
    }
    return CSVParser.serialize(rows);
  }
}

// MARK: - CSV parser/serializer (mirrors the private Swift `CSVParser`)

const CSVParser = {
  /** RFC-4180-ish parse: handles quoted fields, escaped `""`, and CR/LF/CRLF
   * row terminators. Drops all-empty rows. Mirrors Swift `CSVParser.parse`. */
  parse(contents: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    const chars = Array.from(contents);
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < chars.length && chars[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && i + 1 < chars.length && chars[i + 1] === "\n") {
          i += 1;
        }
        row.push(cell);
        if (!row.every((c) => c.length === 0)) {
          rows.push(row);
        }
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
      i += 1;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      if (!row.every((c) => c.length === 0)) {
        rows.push(row);
      }
    }

    return rows;
  },

  /** Serializes rows, quoting any cell containing `,`, `"`, or newline and
   * doubling embedded quotes. Mirrors Swift `CSVParser.serialize`. */
  serialize(rows: string[][]): string {
    return rows.map((row) => row.map(escapeCSV).join(",")).join("\n");
  },
};

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
