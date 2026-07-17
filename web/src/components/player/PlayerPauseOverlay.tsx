import "./PlayerPauseOverlay.css";

/** Compact display metadata supplied by Detail when a player is opened. */
export interface NowPlayingMetadata {
  year?: number | null;
  runtimeMinutes?: number | null;
  rating?: number | null;
  episodeLabel?: string | null;
  overview?: string | null;
  backdropUrl?: string | null;
  posterUrl?: string | null;
}

function runtimeLabel(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

/**
 * A quiet, information-rich paused state shared by the native and webview
 * players. It stays useful when Detail only has a title, while taking advantage
 * of TMDB artwork and episode context when available.
 */
export function PlayerPauseOverlay({
  title,
  nowPlaying,
  onResume,
}: {
  title: string;
  nowPlaying?: NowPlayingMetadata | null;
  onResume: () => void;
}) {
  const runtime = runtimeLabel(nowPlaying?.runtimeMinutes);
  const metadata = [
    nowPlaying?.episodeLabel
      ? { label: nowPlaying.episodeLabel, kind: "episode" }
      : null,
    nowPlaying?.year != null
      ? { label: String(nowPlaying.year), kind: "year" }
      : null,
    runtime ? { label: runtime, kind: "runtime" } : null,
    nowPlaying?.rating != null
      ? { label: `★ ${nowPlaying.rating.toFixed(1)}`, kind: "rating" }
      : null,
  ].filter(
    (item): item is { label: string; kind: string } => item != null,
  );
  const artwork = nowPlaying?.backdropUrl ?? nowPlaying?.posterUrl ?? null;

  return (
    <section
      className="player-pause-screen"
      aria-label={`Paused: ${title}`}
      onClick={onResume}
    >
      {artwork && (
        <img
          className="player-pause-art"
          src={artwork}
          alt=""
          draggable={false}
        />
      )}
      <div className="player-pause-scrim" />
      <div className="player-pause-content">
        <span className="player-pause-eyebrow">Paused</span>
        <h2>{title}</h2>
        {metadata.length > 0 && (
          <p
            className="player-pause-meta"
            aria-label={metadata.map(({ label }) => label).join(" · ")}
          >
            {metadata.map(({ label, kind }) => (
              <span className={`player-pause-meta-item is-${kind}`} key={kind}>
                {label}
              </span>
            ))}
          </p>
        )}
        {nowPlaying?.overview && (
          <p className="player-pause-overview">{nowPlaying.overview}</p>
        )}
      </div>
    </section>
  );
}
