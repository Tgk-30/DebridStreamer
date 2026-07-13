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
import { fetchServerDiscoverHome } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import { getNetworkMode, NetworkBlockedError } from "../lib/networkPolicy";
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

export type DiscoverSource = "live" | "fixtures" | "offline";

export interface DiscoverState {
  data: DiscoverData | null;
  loading: boolean;
  /** True until the secondary (category) rails have all settled. The hero +
   *  Top 10 paint as soon as `loading` clears (after the two trending fetches);
   *  category rails show a skeleton while this is true, then fill in - or, if
   *  genuinely empty, hide. Non-progressive paths (server/fixtures) never set
   *  it true. */
  railsLoading: boolean;
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

const OFFLINE_DISCOVER_MSG =
  "You are offline. Connect to browse new titles. Your downloaded titles still play from Downloads.";

/** True when a Discover fetch failed BECAUSE the privacy gate blocked it (or the
 *  app is simply in Offline mode) - as opposed to a bad key or a real outage. */
function isOfflineFailure(err: unknown): boolean {
  return err instanceof NetworkBlockedError || getNetworkMode() === "offline";
}

/** An honest empty Offline state. Showing bundled demo fixtures as if they were
 *  the real catalog would misrepresent the app's data while offline. */
function offlineDiscoverState(): DiscoverState {
  return {
    data: { ...EMPTY },
    loading: false,
    railsLoading: false,
    error: OFFLINE_DISCOVER_MSG,
    source: "offline",
  };
}

/**
 * React hook that resolves the Discover data once on mount. With a key it loads
 * live; without one it falls back to fixtures so the screen always renders. A
 * live failure (bad key, offline) also falls back to fixtures so the UI never
 * dead-ends during this design phase.
 */
export function useDiscover(tmdb: TMDBService | null): DiscoverState {
  const [state, setState] = useState<DiscoverState>({
    data: null,
    loading: true,
    railsLoading: true,
    error: null,
    source: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (isServerMode()) {
        setState((s) => ({ ...s, loading: true, railsLoading: true }));
        try {
          const data = await fetchServerDiscoverHome();
          if (!cancelled) {
            setState({ data, loading: false, railsLoading: false, error: null, source: "live" });
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!cancelled) {
            setState(
              isOfflineFailure(err)
                ? offlineDiscoverState()
                : {
                    data: loadFixtureDiscover(),
                    loading: false,
                    railsLoading: false,
                    error: message,
                    source: "fixtures",
                  },
            );
          }
          return;
        }
      }

      // Driven by the shared, settings-derived TMDB service (which already folds
      // in the VITE_TMDB_KEY fallback). When the user saves a key in Settings the
      // service identity changes and this effect re-runs, lighting up the catalog
      // without a reload - matching Search/Browse.
      //
      // PROGRESSIVE: paint the hero + Top 10 as soon as the two trending fetches
      // resolve (first paint no longer waits on all six requests), then fill the
      // four category rails independently as each settles.
      if (tmdb) {
        setState((s) => ({ ...s, loading: true, railsLoading: true }));
        let acc: DiscoverData = { ...EMPTY };
        let failed = false;
        const commit = (patch: Partial<DiscoverData>) => {
          if (cancelled || failed) return;
          acc = { ...acc, ...patch };
          setState((s) => ({ ...s, data: acc, source: "live", error: null }));
        };

        const trendingP = Promise.all([
          tmdb.getTrending("movie", "week"),
          tmdb.getTrending("series", "week"),
        ])
          .then(([m, t]) => {
            commit({
              trendingMovies: m.items,
              trendingTV: t.items,
              hero: pickHero(m.items, t.items),
            });
            if (!cancelled) setState((s) => ({ ...s, loading: false }));
          })
          .catch((err) => {
            // Trending is the first-paint content; if it fails (bad key/offline)
            // fall back to fixtures for the WHOLE screen and suppress any later
            // category results so they can't clobber the fallback.
            failed = true;
            if (!cancelled) {
              setState(
                isOfflineFailure(err)
                  ? offlineDiscoverState()
                  : {
                      data: loadFixtureDiscover(),
                      loading: false,
                      railsLoading: false,
                      error: err instanceof Error ? err.message : String(err),
                      source: "fixtures",
                    },
              );
            }
          });

        const categories: Array<["popular" | "top_rated" | "now_playing" | "upcoming", keyof DiscoverData]> = [
          ["popular", "popularMovies"],
          ["top_rated", "topRatedMovies"],
          ["now_playing", "nowPlayingMovies"],
          ["upcoming", "upcomingMovies"],
        ];
        const categoryPs = categories.map(([category, key]) =>
          tmdb
            .getCategory(category, "movie")
            .then((r) => commit({ [key]: r.items } as Partial<DiscoverData>))
            // A single category failing just leaves that rail empty (it hides).
            .catch(() => {}),
        );

        void Promise.allSettled([trendingP, ...categoryPs]).then(() => {
          if (!cancelled && !failed) {
            setState((s) => ({ ...s, railsLoading: false }));
          }
        });
        return;
      }

      if (!cancelled) {
        setState(
          getNetworkMode() === "offline"
            ? offlineDiscoverState()
            : {
                data: loadFixtureDiscover(),
                loading: false,
                railsLoading: false,
                error: null,
                source: "fixtures",
              },
        );
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [tmdb]);

  return state.data ? state : { ...state, data: state.data ?? EMPTY };
}
