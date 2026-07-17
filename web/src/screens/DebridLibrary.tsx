// Debrid Library screen - manage the account's torrents/files.
//
// Renders a searchable, filterable table of the user's debrid torrents (name,
// size, status, added, host, cached/duplicate), with single + bulk delete, a
// refresh button, and a hash-list import/export/AI-emit dialog. Everything here
// is Tauri-only (debrid hosts are CORS-blocked in a plain browser), so without
// Tauri or a configured debrid we show a clear "configure debrid" / "desktop
// only" state. Imports services READ-ONLY via the app store.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/AppStore";
import {
  useDebridLibrary,
  formatSize,
  type DebridRow,
} from "../data/debridLibrary";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { ErrorNote } from "../components/ErrorNote";
import { Spinner } from "../components/Spinner";
import { isTauri } from "../lib/tauri";
import "./LibraryScreens.css";
import "./DebridLibrary.css";

// The hash-list import/export/AI dialog (pako compression + a lot of UI) only
// mounts when opened, so it's code-split out of the DebridLibrary chunk.
const HashListDialog = lazy(() =>
  import("../components/HashListDialog").then((m) => ({
    default: m.HashListDialog,
  })),
);

type Filter = "all" | "duplicates" | "ready";

const TABLE_PAGE_SIZE = 100;

/** "downloaded"/"Ready" → ready-to-play. */
function isReady(status: string): boolean {
  const s = status.toLowerCase();
  return s === "downloaded" || s === "ready";
}

function formatAdded(iso: string | null): string {
  if (iso == null) return " - ";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return " - ";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DebridLibrary() {
  const { services, navigate } = useAppStore();
  const { state, reload } = useDebridLibrary(services.debrid);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renderedRowCount, setRenderedRowCount] = useState(TABLE_PAGE_SIZE);

  const tauri = isTauri();

  const visible: DebridRow[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (q.length > 0 && !row.torrent.name.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "duplicates" && !row.isDuplicate) return false;
      if (filter === "ready" && !isReady(row.torrent.status)) return false;
      return true;
    });
  }, [state.rows, query, filter]);

  // Keep the table's mounted row count bounded even for accounts with thousands
  // of torrents. Reset when the result set changes so a narrower filter does
  // not inherit an unbounded count from a previous "Load more" sequence.
  useEffect(() => {
    setRenderedRowCount(TABLE_PAGE_SIZE);
  }, [visible]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      // Decide by actual membership, not count: a stale cross-filter selection
      // of equal size would otherwise invert the toggle.
      const allVisibleSelected =
        visible.length > 0 && visible.every((r) => prev.has(r.torrent.id));
      return allVisibleSelected
        ? new Set()
        : new Set(visible.map((r) => r.torrent.id));
    });
  }

  async function deleteRows(rows: DebridRow[]) {
    if (services.debrid == null || rows.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      // Fault-tolerant: attempt every delete, collect failures.
      const failures: string[] = [];
      for (const row of rows) {
        try {
          await services.debrid.deleteTorrent(
            row.torrent.id,
            row.torrent.debridService,
          );
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
      setSelected(new Set());
      reload();
      if (failures.length > 0) {
        setActionError(
          `${failures.length} item(s) could not be deleted: ${failures[0]}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.torrent.id)),
    [visible, selected],
  );
  const selectedVisibleCount = useMemo(
    () =>
      visible.reduce(
        (count, row) => count + (selected.has(row.torrent.id) ? 1 : 0),
        0,
      ),
    [visible, selected],
  );
  const allVisibleSelected =
    visible.length > 0 && selectedVisibleCount === visible.length;
  const selectAllIndeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visible.length;
  const renderedRows = visible.slice(0, renderedRowCount);
  const remainingRowCount = visible.length - renderedRows.length;

  // --- Gated states ---------------------------------------------------------

  if (!tauri) {
    return (
      <div className="lib-screen">
        <h1 className="lib-h1">Debrid library</h1>
        <EmptyState
          icon="debrid"
          title="Open the desktop app to manage debrid"
          subtitle="Browser builds cannot talk directly to debrid provider APIs. Install the desktop app to manage torrents, cached files, and provider cleanup from your machine."
          actions={
            <a
              className="btn btn-prominent"
              href="https://github.com/Tgk-30/DebridStreamer/releases/latest"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="debrid" size={15} />
              Download desktop app
            </a>
          }
        />
      </div>
    );
  }

  if (!state.hasDebrid) {
    return (
      <div className="lib-screen">
        <h1 className="lib-h1">Debrid library</h1>
        <EmptyState
          icon="debrid"
          title="Configure a debrid service"
          subtitle="Add a provider token in Settings to see cached files, duplicates, and cleanup actions."
          actions={
            <button
              type="button"
              className="btn btn-prominent"
              onClick={() => navigate("settings")}
            >
              <Icon name="settings" size={15} />
              Open settings
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="lib-screen">
      <div className="dl-head">
        <div>
          <h1 className="lib-h1">Debrid library</h1>
          <p className="lib-sub t-secondary">
            The torrents on your debrid account.
            {state.duplicateCount > 0 &&
              ` ${state.duplicateCount} possible duplicate${state.duplicateCount === 1 ? "" : "s"} flagged.`}
          </p>
        </div>
        <div className="dl-head-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setDialogOpen(true)}
          >
            <Icon name="share" size={15} />
            Hash list
          </button>
          <button
            type="button"
            className="btn"
            onClick={reload}
            disabled={state.loading || busy}
            title="Refresh"
          >
            <Icon name="refresh" size={15} />
            Refresh
          </button>
        </div>
      </div>

      <div className="dl-toolbar">
        <div className="field glass-rest dl-search">
          <Icon name="search" size={16} className="t-secondary" />
          <input
            type="text"
            placeholder="Search torrents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search torrents"
          />
        </div>
        <div className="dl-filters">
          {(["all", "ready", "duplicates"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${filter === f ? " is-active dl-chip-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "ready" ? "Ready" : "Duplicates"}
            </button>
          ))}
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="dl-bulkbar glass-raised glass-lit">
          <span>{selectedRows.length} selected</span>
          <button
            type="button"
            className="btn dl-delete"
            disabled={busy}
            onClick={() => void deleteRows(selectedRows)}
          >
            <Icon name="trash" size={15} />
            Delete selected
          </button>
        </div>
      )}

      {actionError && <ErrorNote className="dl-error">{actionError}</ErrorNote>}
      {state.error && <ErrorNote className="dl-error">{state.error}</ErrorNote>}

      {state.loading ? (
        <div
          className="dl-table glass-lit dl-skel-table"
          aria-busy="true"
          aria-label="Loading your debrid library"
        >
          <div className="dl-row dl-row-head">
            <span className="dl-col-check" />
            <span className="dl-col-name">Name</span>
            <span className="dl-col-size">Size</span>
            <span className="dl-col-status">Status</span>
            <span className="dl-col-added">Added</span>
            <span className="dl-col-host">Host</span>
            <span className="dl-col-actions" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="dl-row dl-skel-row" key={i} aria-hidden="true">
              <span className="dl-col-check">
                <span className="dl-skel dl-skel-check" />
              </span>
              <span className="dl-col-name">
                <span className="dl-skel dl-skel-name" />
                <span className="dl-badges">
                  <span className="dl-skel dl-skel-badge" />
                </span>
              </span>
              <span className="dl-col-size">
                <span className="dl-skel dl-skel-text" />
              </span>
              <span className="dl-col-status">
                <span className="dl-skel dl-skel-pill" />
              </span>
              <span className="dl-col-added">
                <span className="dl-skel dl-skel-text" />
              </span>
              <span className="dl-col-host">
                <span className="dl-skel dl-skel-text" />
              </span>
              <span className="dl-col-actions">
                <span className="dl-skel dl-skel-action" />
              </span>
            </div>
          ))}
        </div>
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon="debrid"
          title="Nothing on your account yet"
          subtitle="Torrents you add (or pre-cache via auto-resolve) will show up here, ready to manage."
          actions={
            <>
              <button
                type="button"
                className="btn btn-prominent"
                onClick={reload}
                disabled={state.loading || busy}
              >
                <Icon name="refresh" size={15} />
                Refresh
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setDialogOpen(true)}
              >
                <Icon name="share" size={15} />
                Import hash list
              </button>
            </>
          }
        />
      ) : visible.length === 0 ? (
        <p className="t-secondary dl-status">No torrents match your filters.</p>
      ) : (
        <>
          <div className="dl-table glass-rest glass-lit">
            <div className="dl-row dl-row-head">
              <span className="dl-col-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  // `indeterminate` is a DOM property with no JSX attribute, so a
                  // callback ref syncs it. It must run on every mount (the header
                  // remounts when the filter empties then repopulates), not only
                  // when the boolean changes, or a remounted checkbox loses its dash.
                  ref={(el) => {
                    if (el != null) el.indeterminate = selectAllIndeterminate;
                  }}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </span>
              <span className="dl-col-name">Name</span>
              <span className="dl-col-size">Size</span>
              <span className="dl-col-status">Status</span>
              <span className="dl-col-added">Added</span>
              <span className="dl-col-host">Host</span>
              <span className="dl-col-actions" />
            </div>
            {renderedRows.map((row) => (
              <div
                key={`${row.torrent.debridService}-${row.torrent.id}`}
                className={`dl-row${row.isDuplicate ? " dl-row-dup" : ""}`}
              >
                <span className="dl-col-check">
                  <input
                    type="checkbox"
                    checked={selected.has(row.torrent.id)}
                    onChange={() => toggleSelected(row.torrent.id)}
                    aria-label={`Select ${row.torrent.name}`}
                  />
                </span>
                <span className="dl-col-name" title={row.torrent.name}>
                  <span className="dl-name-text">{row.torrent.name}</span>
                  <span className="dl-badges">
                    <span className="dl-badge dl-badge-svc">
                      {row.torrent.debridService}
                    </span>
                    {row.isDuplicate && (
                      <span className="dl-badge dl-badge-dup">Duplicate</span>
                    )}
                  </span>
                </span>
                <span className="dl-col-size">{formatSize(row.torrent.sizeBytes)}</span>
                <span className="dl-col-status">
                  <span
                    className={`dl-status-pill${isReady(row.torrent.status) ? " dl-status-ready" : ""}`}
                  >
                    {row.torrent.status}
                  </span>
                </span>
                <span className="dl-col-added">{formatAdded(row.torrent.addedAt)}</span>
                <span className="dl-col-host">{row.torrent.host ?? " - "}</span>
                <span className="dl-col-actions">
                  <button
                    type="button"
                    className="dl-icon-btn"
                    disabled={busy}
                    onClick={() => void deleteRows([row])}
                    aria-label={`Delete ${row.torrent.name}`}
                    title="Delete"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </div>
            ))}
          </div>
          {remainingRowCount > 0 && (
            <div className="dl-load-more">
              <button
                type="button"
                className="btn"
                onClick={() => setRenderedRowCount((count) => count + TABLE_PAGE_SIZE)}
              >
                Load more ({remainingRowCount} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {dialogOpen && (
        <Suspense fallback={<Spinner variant="overlay" />}>
          <HashListDialog
            torrents={state.rows.map((r) => r.torrent)}
            onClose={() => setDialogOpen(false)}
            onImported={reload}
          />
        </Suspense>
      )}
    </div>
  );
}
