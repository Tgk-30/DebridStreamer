// EpisodePicker — the season/episode browser on a series' Detail screen.
//
// Rich mode (an episode guide is available — local TMDB key or the Server-Mode
// metadata proxy): a season chip row plus an episode list with stills, titles,
// air dates/runtimes, per-episode resume bars, and an accent ring on the
// selected episode. Selecting an episode re-drives the stream search below.
//
// Degraded mode (no guide): a plain season/episode stepper so streaming still
// works — "Episode guide unavailable — pick the season and episode to search."

import { useEffect, useState } from "react";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { Episode } from "../models/media";
import { episodeIdFor, useEpisodes, useSeasons } from "../data/episodes";
import "./EpisodePicker.css";

const TMDB_STILL_BASE = "https://image.tmdb.org/t/p/w300";

interface EpisodePickerProps {
  /** Numeric TMDB id for the series (null → degraded stepper mode). */
  tmdbId: number | null;
  tmdb: TMDBService | null;
  selected: { season: number; episode: number };
  onSelect: (next: { season: number; episode: number }) => void;
  /** `s2e5` → 0..1 resume fraction for this series' episodes. */
  progressByEpisodeId?: Record<string, number>;
}

function airDateLabel(airDate: string | null | undefined): string | null {
  if (!airDate) return null;
  const d = new Date(`${airDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function metaLabel(ep: Episode): string {
  const bits = [airDateLabel(ep.airDate), ep.runtime != null ? `${ep.runtime} min` : null];
  return bits.filter(Boolean).join(" · ");
}

export function EpisodePicker({
  tmdbId,
  tmdb,
  selected,
  onSelect,
  progressByEpisodeId = {},
}: EpisodePickerProps) {
  const seasons = useSeasons(tmdbId, true, tmdb);
  const rich = seasons.source === "live";

  // The season being BROWSED (chip row) — follows the selected episode's
  // season by default but browsing doesn't change the selection until an
  // episode is tapped.
  const [browseSeason, setBrowseSeason] = useState(selected.season);
  useEffect(() => {
    setBrowseSeason(selected.season);
  }, [selected.season, tmdbId]);

  const episodes = useEpisodes(
    rich ? tmdbId : null,
    rich ? browseSeason : null,
    tmdb,
  );

  // Degraded stepper state mirrors the selection directly.
  function step(field: "season" | "episode", delta: number) {
    const next = {
      season: Math.max(1, selected.season + (field === "season" ? delta : 0)),
      // Changing season resets the episode to 1 (a new season's numbering).
      episode:
        field === "season"
          ? 1
          : Math.max(1, selected.episode + delta),
    };
    onSelect(next);
  }

  if (seasons.loading) {
    return (
      <section className="episode-picker glass-rest" aria-label="Episodes" aria-busy="true">
        <div className="episode-picker-head">
          <h3 className="episode-picker-title">Episodes</h3>
        </div>
        <ul className="episode-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="episode-row episode-row-skel" aria-hidden>
              <span className="episode-still-skel skel" />
              <span className="episode-body-skel">
                <span className="skel-line skel" />
                <span className="skel-line skel-meta skel" />
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (!rich) {
    return (
      <section className="episode-picker glass-rest" aria-label="Episodes">
        <div className="episode-picker-head">
          <h3 className="episode-picker-title">Episodes</h3>
        </div>
        <p className="episode-picker-note t-secondary">
          Episode guide unavailable — pick the season and episode to search.
        </p>
        <div className="episode-stepper-row">
          {(["season", "episode"] as const).map((field) => (
            <div key={field} className="episode-stepper glass-rest">
              <span className="episode-stepper-label t-secondary">
                {field === "season" ? "Season" : "Episode"}
              </span>
              <button
                type="button"
                className="episode-stepper-btn"
                aria-label={`Previous ${field}`}
                onClick={() => step(field, -1)}
              >
                −
              </button>
              <span className="episode-stepper-value">
                {field === "season" ? selected.season : selected.episode}
              </span>
              <button
                type="button"
                className="episode-stepper-btn"
                aria-label={`Next ${field}`}
                onClick={() => step(field, 1)}
              >
                +
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="episode-picker glass-rest" aria-label="Episodes">
      <div className="episode-picker-head">
        <h3 className="episode-picker-title">Episodes</h3>
        <div className="episode-picker-seasons">
          {seasons.seasons.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                "episode-season-chip chip" +
                (s.seasonNumber === browseSeason ? " is-active" : "")
              }
              aria-pressed={s.seasonNumber === browseSeason}
              onClick={() => setBrowseSeason(s.seasonNumber)}
            >
              {s.name || `Season ${s.seasonNumber}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="episode-list" aria-busy={episodes.loading}>
        {episodes.loading &&
          [0, 1, 2].map((i) => (
            <li key={`skel-${i}`} className="episode-row episode-row-skel" aria-hidden>
              <span className="episode-still-skel skel" />
              <span className="episode-body-skel">
                <span className="skel-line skel" />
                <span className="skel-line skel-meta skel" />
              </span>
            </li>
          ))}
        {!episodes.loading &&
          episodes.episodes.map((ep) => {
            const id = episodeIdFor(ep.seasonNumber, ep.episodeNumber);
            const isSelected =
              ep.seasonNumber === selected.season &&
              ep.episodeNumber === selected.episode;
            const progress = progressByEpisodeId[id];
            const meta = metaLabel(ep);
            return (
              <li key={id} className="episode-row-item">
                <button
                  type="button"
                  className={"episode-row" + (isSelected ? " is-selected" : "")}
                  aria-pressed={isSelected}
                  onClick={() =>
                    onSelect({ season: ep.seasonNumber, episode: ep.episodeNumber })
                  }
                >
                  {ep.stillPath ? (
                    <img
                      className="episode-still"
                      src={`${TMDB_STILL_BASE}${ep.stillPath}`}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <span className="episode-still episode-still-empty" aria-hidden />
                  )}
                  <span className="episode-body">
                    <span className="episode-head">
                      <span className="episode-num chip">E{ep.episodeNumber}</span>
                      <span className="episode-name">
                        {ep.title || `Episode ${ep.episodeNumber}`}
                      </span>
                    </span>
                    {meta !== "" && (
                      <span className="episode-meta t-secondary">{meta}</span>
                    )}
                    {ep.overview && (
                      <span className="episode-overview t-secondary">{ep.overview}</span>
                    )}
                    {progress != null && (
                      <span className="episode-progress" aria-hidden>
                        <span
                          className="episode-progress-fill"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        {!episodes.loading && episodes.episodes.length === 0 && (
          <li className="episode-picker-note t-secondary">
            No episode list for this season yet.
          </li>
        )}
      </ul>
    </section>
  );
}
