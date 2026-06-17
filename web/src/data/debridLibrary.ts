// Debrid Library data layer — the account's torrents/files + dedup detection.
//
// Lists the user's torrents across configured debrid services
// (DebridManager.listTorrents, Tauri-only/CORS-free), and computes a "duplicate
// group" key for each so the UI can flag duplicates. Dedup groups by infoHash
// when known, else by a normalized name + rounded size, matching the brief.
// Pure helpers (groupKey/markDuplicates) are unit-tested; the hook wires them to
// the manager with loading/error/empty state.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DebridManager } from "../services/debrid/DebridManager";
import type { DebridTorrent } from "../services/debrid/models";

/** A torrent row plus its computed duplicate-group key + flag. */
export interface DebridRow {
  torrent: DebridTorrent;
  /** The dedup-group key (infoHash, or name+size fallback). */
  groupKey: string;
  /** True when another row shares this group key. */
  isDuplicate: boolean;
}

export interface DebridLibraryState {
  rows: DebridRow[];
  loading: boolean;
  error: string | null;
  /** Whether any debrid service is configured. */
  hasDebrid: boolean;
  /** How many rows are flagged as duplicates (across all groups). */
  duplicateCount: number;
}

/** Normalize a name for dedup: lowercased, collapse whitespace, strip an
 * extension. Keeps it forgiving so near-identical names group together. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compute the dedup-group key for a torrent. Prefers the infoHash; falls back
 * to a normalized name + size (rounded to the nearest MiB so tiny size drift
 * doesn't split a group). Pure. */
export function groupKey(t: DebridTorrent): string {
  if (t.infoHash && t.infoHash.length > 0) return `hash:${t.infoHash}`;
  const sizeMiB = Math.round(t.sizeBytes / (1024 * 1024));
  return `name:${normalizeName(t.name)}:${sizeMiB}`;
}

/** Mark which torrents are duplicates (share a group key with another). Pure. */
export function markDuplicates(torrents: DebridTorrent[]): DebridRow[] {
  const counts = new Map<string, number>();
  const keys = torrents.map((t) => {
    const key = groupKey(t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return key;
  });
  return torrents.map((torrent, i) => ({
    torrent,
    groupKey: keys[i],
    isDuplicate: (counts.get(keys[i]) ?? 0) > 1,
  }));
}

/** Hook: list the debrid library with dedup flags, plus a `reload` for the
 * refresh button and after deletes. */
export function useDebridLibrary(debrid: DebridManager | null): {
  state: DebridLibraryState;
  reload: () => void;
} {
  const hasDebrid = debrid != null && debrid.hasServices;
  const [state, setState] = useState<DebridLibraryState>({
    rows: [],
    loading: hasDebrid,
    error: null,
    hasDebrid,
    duplicateCount: 0,
  });

  // Monotonic load id so the freshest load wins. Manual callers (Refresh /
  // delete / onImported) and the mount effect all share this; any setState is
  // gated on still being the latest load, so a slow in-flight load can't clobber
  // newer data. Bumping it (on unmount / re-reload) supersedes in-flight loads.
  const loadIdRef = useRef(0);

  const reload = useCallback(() => {
    const myId = ++loadIdRef.current;
    void (async () => {
      if (debrid == null || !debrid.hasServices) {
        if (loadIdRef.current !== myId) return;
        setState({
          rows: [],
          loading: false,
          error: null,
          hasDebrid: false,
          duplicateCount: 0,
        });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const torrents = await debrid.listTorrents();
        if (loadIdRef.current !== myId) return;
        const rows = markDuplicates(torrents);
        setState({
          rows,
          loading: false,
          error: null,
          hasDebrid: true,
          duplicateCount: rows.filter((r) => r.isDuplicate).length,
        });
      } catch (err) {
        if (loadIdRef.current !== myId) return;
        setState({
          rows: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          hasDebrid: true,
          duplicateCount: 0,
        });
      }
    })();
  }, [debrid]);

  useEffect(() => {
    reload();
    return () => {
      // Supersede any in-flight load on unmount / re-reload.
      loadIdRef.current++;
    };
  }, [reload]);

  return { state, reload };
}

/** Format a byte count as a human-readable size (e.g. "4.2 GB"). Pure. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
