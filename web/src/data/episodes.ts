// Episode-picker data layer.
//
// Loads a series' seasons and per-season episode lists - live via the shared
// TMDBService when configured (Local Mode) or the server metadata proxy
// (Server Mode), else a graceful `source: "none"` so the picker can fall back
// to a plain season/episode stepper. Also home to the pure episode-id helpers
// shared by Detail, StreamPicker labels, and continue-watching rows.
// Imports the ported TMDBService READ-ONLY.

import { useEffect, useState } from "react";
import type { Episode, Season } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { WatchHistoryRecord } from "../storage/models";
import { fetchServerEpisodes, fetchServerSeasons } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";

// MARK: - Pure helpers

/** Canonical per-episode id used in storage keys: `s2e5` (no zero-pad).
 * Opaque downstream - only ever produced here and parsed by parseEpisodeId. */
export function episodeIdFor(season: number, episode: number): string {
  return `s${season}e${episode}`;
}

/** Parse an `s2e5` episode id back into numbers. Null for movies (null id)
 * and for unparseable/legacy ids. */
export function parseEpisodeId(
  id: string | null | undefined,
): { season: number; episode: number } | null {
  if (id == null) return null;
  const m = /^s(\d+)e(\d+)$/i.exec(id);
  if (m == null) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}

/** Human label for an episode selection: "S2 E5". */
export function episodeLabel(season: number, episode: number): string {
  return `S${season} E${episode}`;
}

/** The episode after `current`, from TMDB season metadata.
 *  - Within a season: episode + 1.
 *  - At a season boundary: the lowest seasonNumber > current.season with
 *    seasonNumber !== 0 (never advance INTO specials) and episodeCount > 0 → E1.
 *  - After the finale: null.
 *  - seasons.length === 0 (no TMDB key / source "none"): blind within-season
 *    increment, NEVER crosses seasons - a past-the-finale target is harmless
 *    because auto-play requires a cached row and the picker's episode-scoped
 *    empty state is honest. */
export function nextEpisodeFor(
  current: { season: number; episode: number },
  seasons: Season[],
): { season: number; episode: number } | null {
  if (seasons.length === 0) {
    return { season: current.season, episode: current.episode + 1 };
  }
  const here = seasons.find((s) => s.seasonNumber === current.season);
  if (here != null && current.episode < here.episodeCount) {
    return { season: current.season, episode: current.episode + 1 };
  }
  const next = seasons
    .filter((s) => s.seasonNumber > current.season && s.seasonNumber !== 0 && s.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];
  return next != null ? { season: next.seasonNumber, episode: 1 } : null;
}

/** The episode Detail should preselect for a series: the most recently
 * watched episode with a parseable episode id, else S1E1. Sorts by
 * `lastWatched` itself - never trusts the caller's array order. */
export function defaultSelectionFor(
  mediaId: string,
  records: WatchHistoryRecord[],
): { season: number; episode: number } {
  const newest = records
    .filter((r) => r.preview.id === mediaId && parseEpisodeId(r.episodeId) != null)
    .sort((a, b) => b.lastWatched.localeCompare(a.lastWatched))[0];
  return parseEpisodeId(newest?.episodeId) ?? { season: 1, episode: 1 };
}

// MARK: - Hooks

interface SeasonsState {
  seasons: Season[];
  loading: boolean;
  /** "live" when a metadata source produced the list, "none" for the
   * no-key/error fallback (the picker degrades to a stepper). */
  source: "live" | "none";
}

interface EpisodesState {
  episodes: Episode[];
  loading: boolean;
  source: "live" | "none";
}

const NO_SEASONS: SeasonsState = { seasons: [], loading: false, source: "none" };
const NO_EPISODES: EpisodesState = { episodes: [], loading: false, source: "none" };

/** Load the seasons list for a series. `enabled` gates the fetch (pass
 * `type === "series"`); errors and missing tmdbId/service degrade to
 * `source: "none"` - this hook never throws. */
export function useSeasons(
  tmdbId: number | null,
  enabled: boolean,
  tmdb: TMDBService | null,
): SeasonsState {
  const [state, setState] = useState<SeasonsState>({ ...NO_SEASONS, loading: enabled });

  useEffect(() => {
    if (!enabled || tmdbId == null) {
      setState(NO_SEASONS);
      return;
    }
    let cancelled = false;
    setState({ seasons: [], loading: true, source: "none" });

    async function run() {
      try {
        const raw = isServerMode()
          ? (await fetchServerSeasons({ tmdbId: tmdbId! })).seasons
          : tmdb != null
            ? await tmdb.getSeasons(tmdbId!)
            : null;
        if (cancelled) return;
        if (raw == null) {
          setState(NO_SEASONS);
          return;
        }
        // Season 0 is "Specials" - outside the picker's scope this round.
        const seasons = raw.filter((s) => s.seasonNumber > 0);
        setState({
          seasons,
          loading: false,
          source: seasons.length > 0 ? "live" : "none",
        });
      } catch {
        if (!cancelled) setState(NO_SEASONS);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, enabled, tmdb]);

  return state;
}

/** Load one season's episode list. Same degrade-to-"none" contract as
 * useSeasons. */
export function useEpisodes(
  tmdbId: number | null,
  seasonNumber: number | null,
  tmdb: TMDBService | null,
): EpisodesState {
  const [state, setState] = useState<EpisodesState>({
    ...NO_EPISODES,
    loading: tmdbId != null && seasonNumber != null,
  });

  useEffect(() => {
    if (tmdbId == null || seasonNumber == null) {
      setState(NO_EPISODES);
      return;
    }
    let cancelled = false;
    setState({ episodes: [], loading: true, source: "none" });

    async function run() {
      try {
        const raw = isServerMode()
          ? (await fetchServerEpisodes({ tmdbId: tmdbId!, season: seasonNumber! })).episodes
          : tmdb != null
            ? await tmdb.getEpisodes(tmdbId!, seasonNumber!)
            : null;
        if (cancelled) return;
        if (raw == null) {
          setState(NO_EPISODES);
          return;
        }
        setState({
          episodes: raw,
          loading: false,
          source: raw.length > 0 ? "live" : "none",
        });
      } catch {
        if (!cancelled) setState(NO_EPISODES);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, seasonNumber, tmdb]);

  return state;
}
