// Discover data layer.
//
// Loads the Discover catalog either LIVE (when VITE_TMDB_KEY is set: constructs
// a read-only TMDBService and fetches all rails concurrently) or from the dev
// FIXTURES fallback (so the screen renders fully without a key, e.g. for a
// screenshot). Exposes a small React hook, `useDiscover()`, returning the rails,
// the hero item, and load state.
//
// IMPORTANT: imports the ported service/models READ-ONLY. Nothing under
// services/ or models/ is modified.

import { useEffect, useState } from "react";
import type { MediaPreview } from "../models/media";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import { TMDBService } from "../services/metadata/TMDBService";
import { loadDiscoverFixtures } from "./fixtures";

export interface DiscoverData {
  hero: MediaPreview | null;
  trendingMovies: MediaPreview[];
  trendingTV: MediaPreview[];
  popularMovies: MediaPreview[];
  topRatedMovies: MediaPreview[];
  nowPlayingMovies: MediaPreview[];
  upcomingMovies: MediaPreview[];
}

export type DiscoverSource = "live" | "fixtures";

export interface DiscoverState {
  data: DiscoverData | null;
  loading: boolean;
  error: string | null;
  /** Which path produced the data, for a small dev badge in the UI. */
  source: DiscoverSource | null;
}

const EMPTY: DiscoverData = {
  hero: null,
  trendingMovies: [],
  trendingTV: [],
  popularMovies: [],
  topRatedMovies: [],
  nowPlayingMovies: [],
  upcomingMovies: [],
};

/** Featured item: first trending movie with a backdrop, else first trending
 * show with one (mirrors DiscoverView.heroItem). Returns null when none has a
 * backdrop so the hero is hidden rather than rendering a broken box. */
function pickHero(
  trendingMovies: MediaPreview[],
  trendingTV: MediaPreview[],
): MediaPreview | null {
  return (
    trendingMovies.find((m) => MediaPreviewNS.backdropURL(m) != null) ??
    trendingTV.find((m) => MediaPreviewNS.backdropURL(m) != null) ??
    null
  );
}

/** Read the optional Vite env key without assuming `import.meta.env` exists. */
function readTmdbKey(): string | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const key = env?.VITE_TMDB_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

/** Load the Discover catalog live from TMDB, all rails concurrently. */
export async function loadLiveDiscover(
  service: TMDBService,
): Promise<DiscoverData> {
  const [
    trendingMovies,
    trendingTV,
    popularMovies,
    topRatedMovies,
    nowPlayingMovies,
    upcomingMovies,
  ] = await Promise.all([
    service.getTrending("movie", "week"),
    service.getTrending("series", "week"),
    service.getCategory("popular", "movie"),
    service.getCategory("top_rated", "movie"),
    service.getCategory("now_playing", "movie"),
    service.getCategory("upcoming", "movie"),
  ]);

  return {
    trendingMovies: trendingMovies.items,
    trendingTV: trendingTV.items,
    popularMovies: popularMovies.items,
    topRatedMovies: topRatedMovies.items,
    nowPlayingMovies: nowPlayingMovies.items,
    upcomingMovies: upcomingMovies.items,
    hero: pickHero(trendingMovies.items, trendingTV.items),
  };
}

/** Build the Discover catalog from the bundled dev fixtures. */
export function loadFixtureDiscover(): DiscoverData {
  const f = loadDiscoverFixtures();
  return {
    ...f,
    hero: pickHero(f.trendingMovies, f.trendingTV),
  };
}

/**
 * React hook that resolves the Discover data once on mount. With a key it loads
 * live; without one it falls back to fixtures so the screen always renders. A
 * live failure (bad key, offline) also falls back to fixtures so the UI never
 * dead-ends during this design phase.
 */
export function useDiscover(): DiscoverState {
  const [state, setState] = useState<DiscoverState>({
    data: null,
    loading: true,
    error: null,
    source: null,
  });

  useEffect(() => {
    let cancelled = false;
    const key = readTmdbKey();

    async function run() {
      if (key) {
        try {
          const service = new TMDBService(key);
          const data = await loadLiveDiscover(service);
          if (!cancelled) {
            setState({ data, loading: false, error: null, source: "live" });
          }
          return;
        } catch (err) {
          // Fall through to fixtures so the design screen still renders.
          const message = err instanceof Error ? err.message : String(err);
          if (!cancelled) {
            setState({
              data: loadFixtureDiscover(),
              loading: false,
              error: message,
              source: "fixtures",
            });
          }
          return;
        }
      }

      if (!cancelled) {
        setState({
          data: loadFixtureDiscover(),
          loading: false,
          error: null,
          source: "fixtures",
        });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return state.data ? state : { ...state, data: state.data ?? EMPTY };
}
