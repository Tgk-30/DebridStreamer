import { Icon } from "../Icon";
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
  const metadata = [
    nowPlaying?.episodeLabel ?? null,
    nowPlaying?.year != null ? String(nowPlaying.year) : null,
    runtimeLabel(nowPlaying?.runtimeMinutes),
    nowPlaying?.rating != null ? `★ ${nowPlaying.rating.toFixed(1)}` : null,
  ].filter((item): item is string => item != null && item.length > 0);
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
          <p className="player-pause-meta">{metadata.join(" · ")}</p>
        )}
        {nowPlaying?.overview && (
          <p className="player-pause-overview">{nowPlaying.overview}</p>
        )}
        <button
          type="button"
          className="player-pause-play"
          onClick={(event) => {
            event.stopPropagation();
            onResume();
          }}
          aria-label="Resume playback"
          title="Resume playback (Space)"
        >
          <Icon name="play" size={26} filled />
          <span>Resume</span>
        </button>
      </div>
    </section>
  );
}
