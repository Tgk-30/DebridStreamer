// WatchlistImportDialog - bulk-import titles into the watchlist from an IMDb /
// Letterboxd CSV export or a pasted title list. Each parsed entry is resolved to
// a real title via TMDB search (Local Mode) or the server (Server Mode), skipped
// if already on the watchlist, then added. Shows live progress and an
// added / already-there / not-found summary. Parsing + matching are pure (see
// data/importWatchlist.ts); this only drives the flow + UI.

import { useRef, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useModalA11y } from "./useModalA11y";
import { Icon } from "./Icon";
import type { MediaPreview, MediaType } from "../models/media";
import {
  parseWatchlistImport,
  resolveEntry,
  type ImportEntry,
} from "../data/importWatchlist";
import { searchServerMedia } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import { getStore } from "../storage";
import { IMDbCSVSyncService } from "../services/sync/IMDbCSVSyncService";
import "./WatchlistImportDialog.css";

interface Summary {
  added: number;
  skipped: number; // already on the watchlist
  notFound: number; // no TMDB match
  skippedRows: number; // malformed, empty, or duplicate CSV rows
  folderName: string | null;
  folderWarning: string | null;
}

// Bound the paste so the per-keystroke parse can't be handed a huge blob, and so
// an import can't fan out into thousands of TMDB calls.
const MAX_TEXT = 512 * 1024;
const MAX_ENTRIES = 500;

export function WatchlistImportDialog({
  onClose,
  onImported,
  watchlist,
}: {
  onClose: () => void;
  onImported?: () => void;
  watchlist: MediaPreview[];
}) {
  const { services, importToWatchlist } = useAppStore();
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverMode = isServerMode();
  const canResolve = serverMode || services.tmdb != null;
  const parsed = parseWatchlistImport(text, fileName);
  const entries = parsed.entries.slice(0, MAX_ENTRIES);
  const missingIMDbCount = watchlist.filter((item) => item.id.startsWith("tmdb-")).length;

  function exportWatchlist() {
    const csv = new IMDbCSVSyncService().exportCSV(watchlist);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "yawf-stream-watchlist.csv";
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const exportAction = watchlist.length > 0 ? (
    <button type="button" className="btn" onClick={exportWatchlist}>
      Export for IMDb
    </button>
  ) : null;

  const exportNote = watchlist.length > 0 ? (
    <p className="wli-note t-secondary">
      Download a CSV to upload to imdb.com yourself - IMDb has no automatic sync.
      {missingIMDbCount > 0 &&
        ` ${missingIMDbCount} of ${watchlist.length} title${watchlist.length === 1 ? "" : "s"} ${missingIMDbCount === 1 ? "has" : "have"} no IMDb id (exported by title only).`}
    </p>
  ) : null;

  function search(query: string, type: MediaType | null): Promise<MediaPreview[]> {
    if (serverMode) {
      return searchServerMedia({ query, type }).then((r) => r.items);
    }
    if (services.tmdb != null) {
      return services.tmdb.search(query, type).then((r) => r.items);
    }
    return Promise.resolve([]);
  }

  async function readFile(file: File) {
    try {
      // Read at most MAX_TEXT bytes so a hostile multi-GB file can't be pulled
      // into memory - slice the Blob BEFORE reading rather than after.
      const oversize = file.size > MAX_TEXT;
      const content = await (oversize ? file.slice(0, MAX_TEXT) : file).text();
      setText(content);
      setFileName(file.name);
      setSummary(null);
      setError(
        oversize
          ? "That file was large - only the first part was imported."
          : null,
      );
    } catch {
      setError("Could not read that file.");
    }
  }

  async function run() {
    if (entries.length === 0 || !canResolve) return;
    setError(null);
    setSummary(null);
    setProgress({ done: 0, total: entries.length });
    try {
      const resolved: MediaPreview[] = [];
      let notFound = 0;
      for (let i = 0; i < entries.length; i += 1) {
        const entry: ImportEntry = entries[i];
        let match: MediaPreview | null = null;
        try {
          match = await resolveEntry(entry, search);
        } catch {
          match = null; // a single failed lookup shouldn't abort the whole import
        }
        if (match != null) resolved.push(match);
        else notFound += 1;
        setProgress({ done: i + 1, total: entries.length });
      }
      let folderName: string | null = null;
      let folderWarning: string | null = null;
      const store = getStore();
      let folderId: string | null = null;
      if (parsed.folderName != null && resolved.length > 0) {
        try {
          const folder = await store.createWatchlistFolder(parsed.folderName);
          folderName = folder.name;
          folderId = folder.id;
        } catch (err) {
          // Server Mode does not yet persist this local Dexie-only organization
          // model. Preserve the existing import behavior and say so plainly.
          folderWarning = err instanceof Error ? err.message : String(err);
        }
      }
      const { added, skipped } = await importToWatchlist(resolved);
      if (folderId != null) {
        try {
          // File existing titles too, so a catalog import truly results in one
          // folder containing every matched title rather than only new saves.
          await Promise.all(
            resolved.map((preview) => store.assignWatchlistFolder(preview.id, folderId)),
          );
        } catch (err) {
          folderWarning = err instanceof Error ? err.message : String(err);
          folderName = null;
        }
      }
      setSummary({
        added,
        skipped,
        notFound,
        skippedRows: parsed.skippedRows,
        folderName,
        folderWarning,
      });
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="wli-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="wli-dialog glass-hero glass-lit"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import and export watchlist"
        tabIndex={-1}
      >
        <div className="wli-head">
          <h2 className="wli-title">Import and export</h2>
          <button
            type="button"
            className="wli-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="xmark" size={18} />
          </button>
        </div>

        <div className="wli-body">
          {!canResolve ? (
            <p className="wli-note t-secondary">
              Add a TMDB API key in Settings (or connect to a server) to look up
              the titles you import.
            </p>
          ) : (
            <>
              <p className="wli-note t-secondary">
                Paste an <strong>IMDb</strong> or <strong>Letterboxd</strong> CSV
                export, or a plain list of titles (one per line, optionally with a
                year). Each is matched on TMDB and added if it isn't already saved.
              </p>

              <textarea
                className="wli-textarea"
                placeholder={"The Matrix (1999)\nDune\nParasite, 2019"}
                value={text}
                onChange={(e) => {
                  setText(e.target.value.slice(0, MAX_TEXT));
                  setFileName(null);
                  setSummary(null);
                }}
                rows={7}
                maxLength={MAX_TEXT}
                aria-label="Titles or CSV to import"
              />

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="wli-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file != null) void readFile(file);
                  e.target.value = ""; // allow re-selecting the same file
                }}
              />

              <div className="wli-row">
                <span className="t-secondary wli-count">
                  {entries.length > 0
                    ? `${entries.length} title${entries.length === 1 ? "" : "s"} detected`
                    : "No titles detected yet"}
                </span>
                <div className="wli-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileRef.current?.click()}
                    disabled={progress != null}
                  >
                    <Icon name="upload" size={15} />
                    Upload CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-prominent"
                    disabled={entries.length === 0 || progress != null}
                    onClick={() => void run()}
                  >
                    {progress != null
                      ? `Importing ${progress.done}/${progress.total}…`
                      : "Import"}
                  </button>
                  {exportAction}
                </div>
              </div>

              {exportNote}

              {error && <p className="wli-error">{error}</p>}

              {parsed.skippedRows > 0 && !summary && (
                <p className="wli-error">
                  {parsed.skippedRows} malformed, empty, or duplicate CSV row{parsed.skippedRows === 1 ? " was" : "s were"} skipped.
                </p>
              )}

              {summary && (
                <div className="wli-summary glass-rest">
                  <p>
                    <Icon name="check" size={15} className="t-accent" /> Added{" "}
                    {summary.added} title{summary.added === 1 ? "" : "s"} to your
                    watchlist.
                  </p>
                  {(summary.skipped > 0 || summary.notFound > 0 || summary.skippedRows > 0) && (
                    <p className="t-secondary wli-summary-sub">
                      {summary.skipped > 0 &&
                        `${summary.skipped} already saved. `}
                      {summary.notFound > 0 &&
                        `${summary.notFound} couldn't be matched.`}
                      {summary.skippedRows > 0 &&
                        ` ${summary.skippedRows} malformed, empty, or duplicate CSV row${summary.skippedRows === 1 ? " was" : "s were"} skipped.`}
                    </p>
                  )}
                  {summary.folderName != null && (
                    <p className="t-secondary wli-summary-sub">
                      Organized in the {summary.folderName} folder.
                    </p>
                  )}
                  {summary.folderWarning != null && (
                    <p className="wli-error">Imported without a folder: {summary.folderWarning}</p>
                  )}
                </div>
              )}
            </>
          )}
          {!canResolve && exportAction != null && (
            <>
              <div className="wli-row">
                <span className="t-secondary wli-count">
                  {watchlist.length} title{watchlist.length === 1 ? "" : "s"} ready to export
                </span>
                <div className="wli-actions">{exportAction}</div>
              </div>
              {exportNote}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
