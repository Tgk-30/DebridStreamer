// Cached-on-debrid stream picker (mirrors the native StreamListView).
//
// Given resolved stream rows (torrent + cache state from data/streams.ts), this
// renders each as a row with: a quality chip (1080p · H.265 · BluRay · Atmos),
// a green "Instant · RD/AD/PM/TB" badge when it's cached on a debrid service or
// a grey "Will cache" badge otherwise, and seeders / size / indexer metadata.
// A "Cached only" toggle filters to instant streams and the list is cached-first
// sorted. Selecting a row resolves the stream through the caller's resolver
// (local DebridManager in Local Mode, self-hosted API in Server Mode) and hands
// the URL up for playback.

import { useEffect, useMemo, useState } from "react";
import { DebridServiceType, type StreamInfo } from "../services/debrid/models";
import {
  TorrentResult,
  VideoCodec,
  VideoQuality,
} from "../services/indexers/models";
import { filterStreamRows, type StreamRow, type StreamsState } from "../data/streams";
import { useAppStore } from "../store/AppStore";
import { Icon } from "./Icon";
import "./StreamPicker.css";

interface StreamPickerProps {
  state: StreamsState;
  resolveStream: (row: StreamRow) => Promise<StreamInfo>;
  /** Called with the resolved stream + the torrent (for codec/container info). */
  onPlay: (stream: StreamInfo, source: TorrentResult) => void;
  onOpenSettings?: () => void;
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

export function StreamPicker({
  state,
  resolveStream,
  onPlay,
  onOpenSettings,
}: StreamPickerProps) {
  const [cachedOnly, setCachedOnly] = useState(false);
  const [resFilter, setResFilter] = useState<VideoQuality | null>(null);
  const [codecFilter, setCodecFilter] = useState<VideoCodec | null>(null);
  const [resolvingHash, setResolvingHash] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { settings } = useAppStore();

  // Clear the resolution/codec chips whenever the underlying results change
  // (a new title is opened). A stale value is already ignored if it no longer
  // appears, but if the next title HAPPENS to share that resolution/codec the
  // old chip would silently pre-filter it — surprising the user. Resetting on
  // the rows identity keeps the picker unfiltered for each newly opened title.
  useEffect(() => {
    setResFilter(null);
    setCodecFilter(null);
  }, [state.rows]);

  // The data-saver-eligible rows are the basis for both the chips and the list.
  const baseRows = useMemo(
    () => filterStreamRows(state.rows, settings),
    [state.rows, settings],
  );

  // Resolution + codec chips, shown ONLY for the values that actually appear in
  // this title's results (so we never offer a "4K" chip that filters to nothing).
  const availableQualities = useMemo(() => {
    const present = new Set(baseRows.map((r) => r.result.quality));
    return ([
      VideoQuality.uhd4k,
      VideoQuality.hd1080p,
      VideoQuality.hd720p,
      VideoQuality.sd480p,
    ] as const).filter((q) => present.has(q));
  }, [baseRows]);
  const availableCodecs = useMemo(() => {
    const present = new Set(baseRows.map((r) => r.result.codec));
    return ([VideoCodec.h265, VideoCodec.h264, VideoCodec.av1] as const).filter(
      (c) => present.has(c),
    );
  }, [baseRows]);

  // A stale chip (selected, then the title changed and no longer has it) is
  // ignored rather than filtering to an empty list.
  const effRes = resFilter != null && availableQualities.includes(resFilter) ? resFilter : null;
  const effCodec = codecFilter != null && availableCodecs.includes(codecFilter) ? codecFilter : null;

  // Cached-first sort (the underlying list is already quality/seeder sorted).
  const rows = useMemo(() => {
    const filtered = baseRows.filter(
      (r) =>
        (!cachedOnly || r.cachedOn != null) &&
        (effRes == null || r.result.quality === effRes) &&
        (effCodec == null || r.result.codec === effCodec),
    );
    return [...filtered].sort((a, b) => {
      const aCached = a.cachedOn != null ? 1 : 0;
      const bCached = b.cachedOn != null ? 1 : 0;
      return bCached - aCached;
    });
  }, [baseRows, cachedOnly, effRes, effCodec]);

  async function select(row: StreamRow) {
    if (!state.hasDebrid) {
      setResolveError("Configure a debrid service to play.");
      return;
    }
    setResolveError(null);
    setResolvingHash(row.result.infoHash);
    try {
      const stream = await resolveStream(row);
      onPlay(stream, row.result);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingHash(null);
    }
  }

  const filteredCount = baseRows.length;
  const cachedCount = baseRows.filter((r) => r.cachedOn != null).length;
  const hasQualityChips =
    availableQualities.length > 1 || availableCodecs.length > 1;

  return (
    <section className="streams">
      <div className="streams-head">
        <h2 className="streams-title">Available streams</h2>
        {state.hasIndexers && state.rows.length > 0 && (
          <div className="streams-controls">
            <span className="streams-count t-secondary">
              {cachedCount} instant · {state.rows.length} total
              {rows.length < state.rows.length ? ` · ${rows.length} shown` : ""}
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

      {state.hasIndexers && state.rows.length > 0 && hasQualityChips && (
        <div className="streams-filters" role="group" aria-label="Filter streams">
          {availableQualities.length > 1 &&
            availableQualities.map((q) => (
              <button
                key={q}
                type="button"
                className={`chip stream-filter-chip${effRes === q ? " is-active" : ""}`}
                aria-pressed={effRes === q}
                onClick={() => setResFilter((cur) => (cur === q ? null : q))}
              >
                {q}
              </button>
            ))}
          {availableCodecs.length > 1 &&
            availableCodecs.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip stream-filter-chip${effCodec === c ? " is-active" : ""}`}
                aria-pressed={effCodec === c}
                onClick={() => setCodecFilter((cur) => (cur === c ? null : c))}
              >
                {c}
              </button>
            ))}
        </div>
      )}

      {resolveError && <div className="streams-error">{resolveError}</div>}

      <StreamBody
        state={state}
        rows={rows}
        cachedOnly={cachedOnly}
        filteredCount={filteredCount}
        chipFiltersActive={effRes != null || effCodec != null}
        resolvingHash={resolvingHash}
        onSelect={select}
        onShowAll={() => setCachedOnly(false)}
        onClearChips={() => {
          setResFilter(null);
          setCodecFilter(null);
        }}
        onOpenSettings={onOpenSettings}
      />
    </section>
  );
}

function StreamBody({
  state,
  rows,
  cachedOnly,
  filteredCount,
  chipFiltersActive,
  resolvingHash,
  onSelect,
  onShowAll,
  onClearChips,
  onOpenSettings,
}: {
  state: StreamsState;
  rows: StreamRow[];
  cachedOnly: boolean;
  filteredCount: number;
  chipFiltersActive: boolean;
  resolvingHash: string | null;
  onSelect: (row: StreamRow) => void;
  onShowAll: () => void;
  onClearChips: () => void;
  onOpenSettings?: () => void;
}) {
  if (state.loading) {
    return (
      <ul className="streams-list streams-skeleton" aria-busy="true" aria-label="Searching indexers">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i}>
            <div className="stream-row stream-row-skel glass-rest" aria-hidden="true">
              <span className="stream-quality-skel skel" />
              <div className="stream-main">
                <span className="skel-line skel-name skel" />
                <span className="skel-line skel-meta skel" />
              </div>
              <span className="stream-badge-skel skel" />
            </div>
          </li>
        ))}
      </ul>
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
        {onOpenSettings && (
          <div className="streams-empty-actions">
            <button
              type="button"
              className="btn btn-prominent"
              onClick={onOpenSettings}
            >
              <Icon name="settings" size={15} />
              Open settings
            </button>
          </div>
        )}
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
    // Quality/codec chips combined to nothing (each chip alone always matches,
    // but a resolution+codec combination can be empty).
    const chipsEmpty = chipFiltersActive && filteredCount > 0;
    const cachedOnlyEmpty = !chipsEmpty && cachedOnly && filteredCount > 0;
    const filtersEmpty = !chipsEmpty && state.rows.length > 0 && filteredCount === 0;

    return (
      <div className="streams-empty glass-rest">
        <p className="streams-empty-title">
          {chipsEmpty
            ? "No streams match those filters"
            : cachedOnlyEmpty
              ? "No instant streams shown"
              : filtersEmpty
                ? "Playback filters hid every stream"
                : "No streams found"}
        </p>
        <p className="t-secondary streams-empty-sub">
          {chipsEmpty
            ? "No release matches that resolution + codec combination. Clear a filter to see more."
            : cachedOnlyEmpty
              ? "Switch off Cached only to show sources that can be cached first."
              : filtersEmpty
                ? "Your quality or file-size limits removed the available results for this title."
                : "The configured sources did not return a match for this title yet. Add another indexer or try a different release."}
        </p>
        <div className="streams-empty-actions">
          {chipsEmpty && (
            <button type="button" className="btn" onClick={onClearChips}>
              Clear filters
            </button>
          )}
          {cachedOnlyEmpty && (
            <button type="button" className="btn" onClick={onShowAll}>
              Show all streams
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              className={cachedOnlyEmpty ? "btn" : "btn btn-prominent"}
              onClick={onOpenSettings}
            >
              <Icon name="settings" size={15} />
              Open settings
            </button>
          )}
        </div>
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
        className={`stream-row glass-rest glass-lit${cached ? " is-instant" : ""}`}
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

        {resolving ? (
          <span className="stream-badge is-resolving">
            <span className="stream-spin" aria-hidden="true" />
            Resolving…
          </span>
        ) : (
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
        )}
      </button>
    </li>
  );
}
