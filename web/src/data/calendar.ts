// Calendar data layer - upcoming episode air dates for the user's TV series.
//
// Gathers every TV series across the Library (favorites) + Watchlist from the
// Store, then concurrently resolves each series' upcoming/unaired episodes via
// TMDB (lib/metadata.getUpcomingEpisodesForSeries). The result is grouped into
// Today / This week / Later buckets for the agenda. Fault-tolerant + gates
// gracefully without a TMDB key (empty state). Imports services READ-ONLY.

import { useEffect, useState } from "react";
import type { MediaPreview } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";
import { getStore } from "../storage";
import {
  getUpcomingEpisodesForSeries,
  localISODate,
  type UpcomingEpisode,
} from "../lib/metadata";
import { fetchServerUpcomingEpisodes } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";

/** A date-keyed group of upcoming episodes. */
export interface CalendarGroup {
  /** One of "today" | "week" | "later" - drives the section heading. */
  bucket: "today" | "week" | "later";
  label: string;
  episodes: UpcomingEpisode[];
}

export interface CalendarState {
  groups: CalendarGroup[];
  loading: boolean;
  error: string | null;
  /** Whether the user has any TV series in library/watchlist at all. */
  hasSeries: boolean;
  /** Whether a TMDB key is configured (drives the no-key empty copy). */
  hasTMDB: boolean;
}

/** Collect the unique TV series across favorites + watchlist from the Store. */
export async function collectSeries(): Promise<MediaPreview[]> {
  const store = getStore();
  const [favorites, watchlist] = await Promise.all([
    store.listLibrary("favorites").catch(() => []),
    store.listWatchlist().catch(() => []),
  ]);
  const previews: MediaPreview[] = [
    ...favorites.map((e) => e.preview),
    ...watchlist.map((r) => r.preview),
  ];
  // Unique by id, series only.
  const seen = new Set<string>();
  const out: MediaPreview[] = [];
  for (const p of previews) {
    if (p.type !== "series" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Bucket + label episodes into Today / This week / Later. `now` is injectable
 * for testing. Pure. */
export function groupEpisodes(
  episodes: UpcomingEpisode[],
  now: number = Date.now(),
): CalendarGroup[] {
  // Local calendar day, not UTC: TMDB air dates are bare local-date strings, so
  // comparing against the UTC date would drop/mis-bucket by a day for non-UTC
  // users in evening/early-morning windows (see localISODate).
  const today = localISODate(now);
  const weekEnd = localISODate(now + 7 * 24 * 60 * 60 * 1000);

  const todayEps: UpcomingEpisode[] = [];
  const weekEps: UpcomingEpisode[] = [];
  const laterEps: UpcomingEpisode[] = [];
  for (const ep of episodes) {
    // Defensive lower bound: a stale/past air date (already aired) is not
    // "upcoming" - drop it rather than mis-bucketing it as "This week". ISO
    // YYYY-MM-DD strings compare lexicographically.
    if (ep.airDate < today) continue;
    if (ep.airDate === today) todayEps.push(ep);
    else if (ep.airDate <= weekEnd) weekEps.push(ep);
    else laterEps.push(ep);
  }

  const groups: CalendarGroup[] = [];
  if (todayEps.length > 0) {
    groups.push({ bucket: "today", label: "Today", episodes: todayEps });
  }
  if (weekEps.length > 0) {
    groups.push({ bucket: "week", label: "This week", episodes: weekEps });
  }
  if (laterEps.length > 0) {
    groups.push({ bucket: "later", label: "Upcoming", episodes: laterEps });
  }
  return groups;
}

/** Resolve the calendar agenda for the user's series. */
export function useCalendar(tmdb: TMDBService | null): CalendarState {
  const serverMode = isServerMode();
  const [state, setState] = useState<CalendarState>({
    groups: [],
    loading: true,
    error: null,
    hasSeries: false,
    hasTMDB: tmdb != null || serverMode,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState((s) => ({
        ...s,
        loading: true,
        error: null,
        hasTMDB: tmdb != null || serverMode,
      }));
      try {
        const series = await collectSeries();
        if (cancelled) return;
        if (series.length === 0 || (tmdb == null && !serverMode)) {
          setState({
            groups: [],
            loading: false,
            error: null,
            hasSeries: series.length > 0,
            hasTMDB: tmdb != null || serverMode,
          });
          return;
        }
        const episodes = serverMode
          ? await fetchServerUpcomingEpisodes(series)
          : await getUpcomingEpisodesForSeries(series, tmdb);
        if (cancelled) return;
        setState({
          groups: groupEpisodes(episodes),
          loading: false,
          error: null,
          hasSeries: true,
          hasTMDB: true,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          groups: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          hasSeries: false,
          hasTMDB: tmdb != null || serverMode,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdb, serverMode]);

  return state;
}
