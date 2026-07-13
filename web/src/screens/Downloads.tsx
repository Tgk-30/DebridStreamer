import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { getDownloadsBridge, type DownloadProgress } from "../lib/downloadsBridge";
import { isTauri } from "../lib/tauri";
import { getStore } from "../storage";
import type { DownloadRecord } from "../storage/models";
import { startDownloadsRuntime } from "../services/downloads";
import { useAppStore } from "../store/AppStore";
import "./LibraryScreens.css";
import "./DebridLibrary.css";
import "./Downloads.css";

function percent(record: DownloadRecord): number | null {
  if (record.bytesTotal == null || record.bytesTotal <= 0) return null;
  return Math.min(100, Math.round((record.bytesDone / record.bytesTotal) * 100));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n >= 10 ? n.toFixed(0) : n.toFixed(1)} ${units[unit]}`;
}

function statusLabel(status: DownloadRecord["status"]): string {
  return status === "resolving" ? "Resolving" : `${status[0].toUpperCase()}${status.slice(1)}`;
}

function progressLabel(record: DownloadRecord, speedBps?: number): string {
  const progress = percent(record);
  const amount =
    record.bytesTotal != null
      ? `${formatBytes(record.bytesDone)} / ${formatBytes(record.bytesTotal)}`
      : formatBytes(record.bytesDone);
  const speed = speedBps != null && speedBps > 0 ? ` · ${formatBytes(speedBps)}/s` : "";
  return `${progress == null ? amount : `${progress}% · ${amount}`}${speed}`;
}

export interface DownloadSeriesGroup {
  mediaId: string;
  title: string;
  seasons: Array<{ season: number | null; records: DownloadRecord[] }>;
}

/** Group the flat, durable queue for display only. The queue engine continues
 * to operate on its original flat records. */
export function groupDownloads(records: DownloadRecord[]): {
  movies: DownloadRecord[];
  series: DownloadSeriesGroup[];
} {
  const movies: DownloadRecord[] = [];
  const seriesByMediaId = new Map<string, DownloadRecord[]>();
  for (const record of records) {
    if (record.episodeId == null) movies.push(record);
    else {
      const group = seriesByMediaId.get(record.mediaId) ?? [];
      group.push(record);
      seriesByMediaId.set(record.mediaId, group);
    }
  }

  const series = [...seriesByMediaId.entries()].map(([mediaId, episodes]) => {
    const first = episodes[0]!;
    const title = first.title
      .replace(/\s+[Ss]\d{1,2}[Ee]\d{1,3}\b.*$/, "")
      .trim() || first.title;
    const seasonsByNumber = new Map<number | null, DownloadRecord[]>();
    for (const episode of episodes) {
      const season = episode.season;
      const seasonGroup = seasonsByNumber.get(season) ?? [];
      seasonGroup.push(episode);
      seasonsByNumber.set(season, seasonGroup);
    }
    const seasons = [...seasonsByNumber.entries()]
      .sort(([a], [b]) => {
        if (a == null) return 1;
        if (b == null) return -1;
        return a - b;
      })
      .map(([season, seasonRecords]) => ({
        season,
        records: [...seasonRecords].sort((a, b) => {
          if (a.episode == null && b.episode == null) return a.title.localeCompare(b.title);
          if (a.episode == null) return 1;
          if (b.episode == null) return -1;
          return a.episode - b.episode;
        }),
      }));
    return { mediaId, title, seasons };
  });

  return { movies, series };
}

export function Downloads() {
  const { services, navigate } = useAppStore();
  const tauri = isTauri();
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tauri) return;
    const store = getStore();
    const manager = startDownloadsRuntime(store, services.debrid);
    const unlistenStore = store.subscribeDownloads(setRecords);
    const unlistenProgress = manager.subscribeProgress((progress: DownloadProgress) => {
      if (progress.speedBps == null) return;
      setSpeeds((previous) => ({ ...previous, [progress.jobId]: progress.speedBps! }));
    });
    void getDownloadsBridge()
      .downloadsFfmpegAvailable()
      .then(setFfmpegAvailable)
      .catch(() => setFfmpegAvailable(false));
    return () => {
      unlistenStore();
      unlistenProgress();
    };
  }, [services.debrid, tauri]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selected.has(record.jobId)),
    [records, selected],
  );
  const groupedRecords = useMemo(() => groupDownloads(records), [records]);

  if (!tauri) {
    return (
      <div className="lib-screen">
        <h1 className="lib-h1">Downloads</h1>
        <EmptyState
          icon="debrid"
          title="Open the desktop app to download"
          subtitle="Browser builds can stream but cannot write debrid files to your device. Open DebridStreamer for desktop to queue and manage downloads."
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

  const manager = startDownloadsRuntime(getStore(), services.debrid);
  const toggleSelected = (jobId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const clearSelected = async () => {
    await Promise.all(selectedRecords.map((record) => getStore().deleteDownload(record.jobId)));
    setSelected(new Set());
  };

  return (
    <div className="lib-screen downloads-screen">
      <div className="dl-head">
        <div>
          <h1 className="lib-h1">Downloads</h1>
          <p className="lib-sub t-secondary">
            Downloads run on this desktop and continue in the background while the app is open.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => navigate("settings")}>
          <Icon name="settings" size={15} />
          Folder settings
        </button>
      </div>

      {ffmpegAvailable === false && (
        <p className="downloads-note t-secondary">
          Optimized downloads are unavailable because FFmpeg was not found. Full-size downloads still work.
        </p>
      )}

      {selectedRecords.length > 0 && (
        <div className="dl-bulkbar glass-raised glass-lit">
          <span>{selectedRecords.length} selected</span>
          <button type="button" className="btn dl-delete" onClick={() => void clearSelected()}>
            <Icon name="trash" size={15} />
            Remove selected
          </button>
        </div>
      )}

      {records.length === 0 ? (
        <EmptyState
          icon="debrid"
          title="Your download queue is empty"
          subtitle="Choose Download from a movie or episode to save it to this desktop."
        />
      ) : (
        <div className="downloads-groups">
          {groupedRecords.movies.length > 0 && (
            <DownloadSection
              heading="Movies"
              records={groupedRecords.movies}
              selected={selected}
              toggleSelected={toggleSelected}
              speeds={speeds}
              manager={manager}
            />
          )}
          {groupedRecords.series.length > 0 && (
            <section className="downloads-series-section" aria-labelledby="downloads-series-heading">
              <h2 id="downloads-series-heading" className="downloads-section-heading">Series</h2>
              {groupedRecords.series.map((series) => (
                <section key={series.mediaId} className="downloads-show-section" aria-label={series.title}>
                  <h3 className="downloads-show-heading">{series.title}</h3>
                  {series.seasons.map(({ season, records: seasonRecords }) => (
                    <DownloadSection
                      key={season ?? "unassigned"}
                      heading={season == null ? "Episodes" : `Season ${season}`}
                      nested
                      records={seasonRecords}
                      selected={selected}
                      toggleSelected={toggleSelected}
                      speeds={speeds}
                      manager={manager}
                    />
                  ))}
                </section>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function DownloadSection({
  heading,
  nested = false,
  records,
  selected,
  toggleSelected,
  speeds,
  manager,
}: {
  heading: string;
  nested?: boolean;
  records: DownloadRecord[];
  selected: Set<string>;
  toggleSelected: (jobId: string) => void;
  speeds: Record<string, number>;
  manager: ReturnType<typeof startDownloadsRuntime>;
}) {
  return (
    <section className={`downloads-section${nested ? " is-nested" : ""}`}>
      {nested ? <h4 className="downloads-season-heading">{heading}</h4> : <h2 className="downloads-section-heading">{heading}</h2>}
      <div className="dl-table glass-rest glass-lit downloads-table">
        <div className="downloads-row downloads-row-head">
          <span className="dl-col-check" />
          <span>Title</span>
          <span>Mode</span>
          <span>Progress</span>
          <span>Status</span>
          <span className="dl-col-actions" />
        </div>
        {records.map((record) => {
          const progress = percent(record) ?? 0;
          const canPause = ["resolving", "downloading", "optimizing"].includes(record.status);
          const canResume = record.status === "paused";
          const canForceStop = !["completed", "canceled"].includes(record.status);
          return (
            <div key={record.jobId} className="downloads-row">
              <span className="dl-col-check">
                <input
                  type="checkbox"
                  checked={selected.has(record.jobId)}
                  onChange={() => toggleSelected(record.jobId)}
                  aria-label={`Select ${record.title}`}
                />
              </span>
              <span className="downloads-title" title={record.title}>
                <strong>{record.title}</strong>
                {record.error != null && <small className="dl-error">{record.error}</small>}
              </span>
              <span className="downloads-mode">
                {record.mode === "optimized"
                  ? `Optimized · ${record.optimizeProfile ?? "remux"}`
                  : "Full size"}
              </span>
              <span className="downloads-progress">
                <span className="downloads-progress-track" aria-hidden>
                  <span style={{ width: `${progress}%` }} />
                </span>
                <small>{progressLabel(record, speeds[record.jobId] ?? manager.speedFor(record.jobId))}</small>
              </span>
              <span>
                <span className={`dl-status-pill downloads-status-${record.status}`}>
                  {statusLabel(record.status)}
                </span>
              </span>
              <span className="downloads-actions">
                {canPause && (
                  <button type="button" className="dl-icon-btn" onClick={() => void manager.pause(record.jobId)} aria-label={`Pause ${record.title}`} title="Pause">
                    Ⅱ
                  </button>
                )}
                {canResume && (
                  <button type="button" className="dl-icon-btn" onClick={() => void manager.resume(record.jobId)} aria-label={`Resume ${record.title}`} title="Resume">
                    <Icon name="play" size={14} />
                  </button>
                )}
                {canForceStop && (
                  <button type="button" className="dl-icon-btn downloads-cancel" onClick={() => void manager.forceStop(record.jobId)} aria-label={`Force stop ${record.title}`} title="Force stop">
                    <Icon name="xmark" size={15} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
