// Cached-on-debrid stream picker (mirrors the native StreamListView).
//
// Given resolved stream rows (torrent + cache state from data/streams.ts), this
// renders each as a row with: a quality chip (1080p · H.265 · BluRay · Atmos),
// a green "Instant · RD/AD/PM/TB" badge when it's cached on a debrid service or
// a grey "Will cache" badge otherwise, and seeders / size / indexer metadata.
// A "Cached only" toggle filters to instant streams and the list is cached-first
// sorted. Selecting a row resolves the stream via DebridManager.resolveStream
// and hands the URL up for playback.

import { useMemo, useState } from "react";
import type { DebridManager } from "../services/debrid/DebridManager";
import { DebridServiceType, type StreamInfo } from "../services/debrid/models";
import { TorrentResult } from "../services/indexers/models";
import type { StreamRow, StreamsState } from "../data/streams";
import { Icon } from "./Icon";
import "./StreamPicker.css";

interface StreamPickerProps {
  state: StreamsState;
  debrid: DebridManager | null;
  /** Called with the resolved stream + the torrent (for codec/container info). */
  onPlay: (stream: StreamInfo, source: TorrentResult) => void;
}

/** Bytes → "1.4 GB" style. */
function formatSize(bytes: number): string {
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

export function StreamPicker({ state, debrid, onPlay }: StreamPickerProps) {
  const [cachedOnly, setCachedOnly] = useState(false);
  const [resolvingHash, setResolvingHash] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Cached-first sort (the underlying list is already quality/seeder sorted).
  const rows = useMemo(() => {
    const filtered = cachedOnly
      ? state.rows.filter((r) => r.cachedOn != null)
      : state.rows;
    return [...filtered].sort((a, b) => {
      const aCached = a.cachedOn != null ? 1 : 0;
      const bCached = b.cachedOn != null ? 1 : 0;
      return bCached - aCached;
    });
  }, [state.rows, cachedOnly]);

  async function select(row: StreamRow) {
    if (debrid == null || !debrid.hasServices) {
      setResolveError("Configure a debrid service to play.");
      return;
    }
    setResolveError(null);
    setResolvingHash(row.result.infoHash);
    try {
      const stream = await debrid.resolveStream(
        row.result.infoHash,
        row.cachedOn,
      );
      onPlay(stream, row.result);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingHash(null);
    }
  }

  const cachedCount = state.rows.filter((r) => r.cachedOn != null).length;

  return (
    <section className="streams">
      <div className="streams-head">
        <h2 className="streams-title">Available streams</h2>
        {state.hasIndexers && state.rows.length > 0 && (
          <div className="streams-controls">
            <span className="streams-count t-secondary">
              {cachedCount} instant · {state.rows.length} total
            </span>
            <label className="streams-toggle">
              <input
                type="checkbox"
                checked={cachedOnly}
                onChange={(e) => setCachedOnly(e.target.checked)}
              />
              Cached only
            </label>
          </div>
        )}
      </div>

      {resolveError && <div className="streams-error">{resolveError}</div>}

      <StreamBody
        state={state}
        rows={rows}
        resolvingHash={resolvingHash}
        onSelect={select}
      />
    </section>
  );
}

function StreamBody({
  state,
  rows,
  resolvingHash,
  onSelect,
}: {
  state: StreamsState;
  rows: StreamRow[];
  resolvingHash: string | null;
  onSelect: (row: StreamRow) => void;
}) {
  if (state.loading) {
    return (
      <div className="streams-empty glass-rest">
        <span className="t-secondary">Searching indexers…</span>
      </div>
    );
  }

  if (!state.hasIndexers) {
    return (
      <div className="streams-empty glass-rest">
        <Icon name="search" size={22} className="t-secondary" />
        <p className="streams-empty-title">No sources configured</p>
        <p className="t-secondary streams-empty-sub">
          Add an indexer (or enable the built-in scrapers) in Settings to find
          streams.
        </p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="streams-empty glass-rest">
        <p className="streams-empty-title">Couldn't search streams</p>
        <p className="t-secondary streams-empty-sub">{state.error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="streams-empty glass-rest">
        <p className="streams-empty-title">No streams found</p>
        <p className="t-secondary streams-empty-sub">
          Nothing matched on the configured indexers.
        </p>
      </div>
    );
  }

  return (
    <ul className="streams-list">
      {rows.map((row) => (
        <StreamRowItem
          key={row.result.infoHash}
          row={row}
          resolving={resolvingHash === row.result.infoHash}
          onSelect={() => onSelect(row)}
        />
      ))}
    </ul>
  );
}

function StreamRowItem({
  row,
  resolving,
  onSelect,
}: {
  row: StreamRow;
  resolving: boolean;
  onSelect: () => void;
}) {
  const { result, cachedOn } = row;
  const cached = cachedOn != null;

  return (
    <li>
      <button
        type="button"
        className="stream-row glass-rest glass-lit"
        onClick={onSelect}
        disabled={resolving}
        title={result.title}
      >
        <span className="stream-quality">{result.quality}</span>

        <div className="stream-main">
          <div className="stream-name">{result.title}</div>
          <div className="stream-meta t-secondary">
            <span>{TorrentResult.qualityLabel(result)}</span>
            <span>·</span>
            <span>{formatSize(result.sizeBytes)}</span>
            <span>·</span>
            <span>{result.seeders} seeders</span>
            <span>·</span>
            <span>{result.indexerName}</span>
          </div>
        </div>

        <span className={`stream-badge ${cached ? "is-cached" : "is-cache"}`}>
          {cached ? (
            <>
              <Icon name="play" size={11} />
              Instant · {DebridServiceType.shortCode(cachedOn!)}
            </>
          ) : (
            "Will cache"
          )}
        </span>
      </button>
    </li>
  );
}
