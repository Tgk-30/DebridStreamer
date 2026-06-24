// Browse data layer.
//
// Powers the paginated Browse screen ("See all" + advanced filters). A Browse
// is driven by a `BrowseContext` (a discriminated union: a category, a single
// genre, a free-text search, or a full `discover` filter set). This module maps
// a context + page number onto the right read-only TMDBService method, appends
// pages for load-more / infinite scroll (stopping at `totalPages`), and exposes
// a small React hook, `useBrowse()`, with loading/empty/error state.
//
// Like the Discover hook it gates gracefully without a TMDB key: it filters the
// bundled fixtures locally so the screen still renders (single page, no live
// pagination). Live failures also fall back to an empty page rather than
// dead-ending. TMDBService/models are imported READ-ONLY.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaPreview, MediaType } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";
import {
  type DiscoverFilters,
  MediaCategory,
  makeDiscoverFilters,
  SortOption,
} from "../services/metadata/types";
import {
  discoverServerMedia,
  fetchServerCategory,
  searchServerMedia,
} from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import { loadDiscoverFixtures } from "./fixtures";

// ---- Browse context ---------------------------------------------------------

/** A "trending" / category target (Discover's rail kinds). */
export interface CategoryTarget {
  kind: "category";
  type: MediaType;
  /** `"trending"` plus the TMDB MediaCategory list values. */
  category: "trending" | MediaCategory;
}

/** A single-genre target (a genre rail → Browse with that genre pre-set). */
export interface GenreTarget {
  kind: "genre";
  type: MediaType;
  genreId: number;
  genreName: string;
}

/** A free-text TMDB search target ("See all" / deepen from Search). */
export interface SearchTarget {
  kind: "search";
  type: MediaType | null;
  query: string;
}

/** A full discover() filter target (the advanced filter slideover). */
export interface DiscoverTarget {
  kind: "discover";
  type: MediaType;
  filters: BrowseFilters;
}

export type BrowseContext =
  | CategoryTarget
  | GenreTarget
  | SearchTarget
  | DiscoverTarget;

/** The advanced-filter draft the slideover edits. A superset of TMDB's
 * `DiscoverFilters` (which only carries genreId/year/minRating/sortBy/page) —
 * the extra fields are threaded through `buildDiscoverParams` as raw discover
 * query params (vote_count.gte, runtime, year range, language, multi-genre). */
export interface BrowseFilters {
  genreIds: number[];
  yearGTE: number | null;
  yearLTE: number | null;
  minRating: number | null;
  minVotes: number | null;
  runtimeLTE: number | null;
  originalLanguage: string | null;
  sortBy: SortOption;
}

/** A blank filter draft (most-popular, nothing constrained). */
export function emptyBrowseFilters(): BrowseFilters {
  return {
    genreIds: [],
    yearGTE: null,
    yearLTE: null,
    minRating: null,
    minVotes: null,
    runtimeLTE: null,
    originalLanguage: null,
    sortBy: SortOption.popularityDesc,
  };
}

/** True when a draft constrains anything beyond the default sort. Used to show
 * the "filtered" affordance / decide whether removable chips appear. */
export function hasActiveFilters(f: BrowseFilters): boolean {
  return (
    f.genreIds.length > 0 ||
    f.yearGTE != null ||
    f.yearLTE != null ||
    f.minRating != null ||
    f.minVotes != null ||
    f.runtimeLTE != null ||
    f.originalLanguage != null ||
    f.sortBy !== SortOption.popularityDesc
  );
}

// ---- Titles -----------------------------------------------------------------

const CATEGORY_TITLES: Record<string, string> = {
  trending: "Trending",
  popular: "Popular",
  top_rated: "Top rated",
  now_playing: "Now playing",
  upcoming: "Upcoming",
  airing_today: "Airing today",
  on_the_air: "On the air",
};

function typeNoun(type: MediaType): string {
  return type === "movie" ? "movies" : "TV";
}

/** A sentence-case heading describing the active context (e.g. "Popular TV",
 * "Action movies", "Results for ‘dune’", "Discover movies"). */
export function browseTitle(ctx: BrowseContext): string {
  switch (ctx.kind) {
    case "category": {
      const word = CATEGORY_TITLES[ctx.category] ?? "Browse";
      return `${word} ${typeNoun(ctx.type)}`;
    }
    case "genre":
      return `${ctx.genreName} ${typeNoun(ctx.type)}`;
    case "search":
      return `Results for “${ctx.query}”`;
    case "discover":
      return `Discover ${typeNoun(ctx.type)}`;
  }
}

// ---- Discover param building (the filter superset → TMDB query params) -------

/** Translate a `BrowseFilters` draft + page into the raw TMDB `/discover` query
 * params. Pure + exported so it can be unit-tested without the network. Mirrors
 * the subset TMDBService.discover() builds, extended with the slideover's extra
 * fields (multi-genre, year range, min votes, runtime, language). */
/** Clamp a year to a plausible 4-digit window; anything outside → null. A 1-3
 * digit (or absurd-future) value — e.g. the "20" a user has typed so far toward
 * "2010" — would otherwise build a malformed "20-01-01" discover date param and
 * silently return wrong/empty results. The input itself stays permissive
 * (parseYear) so it's typeable; this clamp only governs whether the bound is
 * actually applied to a query. */
export function plausibleYear(y: number | null): number | null {
  if (y == null) return null;
  return y >= 1900 && y <= new Date().getFullYear() + 5 ? y : null;
}

/** Return [floor, ceiling] for a year range, swapping if the caller passed them
 * inverted (From > To). Either side may be null (open-ended). Pure + exported so
 * both the live discover params and the fixture filter agree. */
export function orderYearBounds(
  gte: number | null,
  lte: number | null,
): [number | null, number | null] {
  if (gte != null && lte != null && gte > lte) return [lte, gte];
  return [gte, lte];
}

export function buildDiscoverParams(
  type: MediaType,
  filters: BrowseFilters,
  page: number,
): Record<string, string> {
  const params: Record<string, string> = {
    page: String(page),
    sort_by: filters.sortBy,
    language: "en-US",
    include_adult: "false",
  };

  if (filters.genreIds.length > 0) {
    params.with_genres = filters.genreIds.join(",");
  }
  // Clamp implausible/partial years to null, then swap an inverted range
  // (From=2020, To=2000) so the floor is never above the ceiling — TMDB returns
  // an empty set otherwise, which reads as a silent bug.
  const [yearGTE, yearLTE] = orderYearBounds(
    plausibleYear(filters.yearGTE),
    plausibleYear(filters.yearLTE),
  );
  if (yearGTE != null) {
    const key =
      type === "movie" ? "primary_release_date.gte" : "first_air_date.gte";
    params[key] = `${yearGTE}-01-01`;
  }
  if (yearLTE != null) {
    const key =
      type === "movie" ? "primary_release_date.lte" : "first_air_date.lte";
    params[key] = `${yearLTE}-12-31`;
  }
  if (filters.minRating != null) {
    params["vote_average.gte"] = String(filters.minRating);
    // Default a sane vote floor when filtering by rating so a single 10/10 vote
    // doesn't dominate — overridden by an explicit minVotes below.
    params["vote_count.gte"] = "50";
  }
  if (filters.minVotes != null) {
    params["vote_count.gte"] = String(filters.minVotes);
  }
  // Runtime is a movie-only TMDB facet (with_runtime applies to movies); never
  // emit it for TV even if a stale value leaked into the draft.
  if (filters.runtimeLTE != null && type === "movie") {
    params["with_runtime.lte"] = String(filters.runtimeLTE);
  }
  if (filters.originalLanguage != null && filters.originalLanguage.length > 0) {
    params.with_original_language = filters.originalLanguage;
  }

  return params;
}

/** A `BrowseFilters` draft narrowed to the genre/year/rating/sort fields the
 * core TMDBService.discover() understands (used when calling it directly). */
export function toDiscoverFilters(
  filters: BrowseFilters,
  page: number,
): DiscoverFilters {
  return makeDiscoverFilters({
    genreId: filters.genreIds[0] ?? null,
    year: filters.yearGTE ?? filters.yearLTE ?? null,
    minRating: filters.minRating,
    sortBy: filters.sortBy,
    page,
  });
}

// ---- Page loading -----------------------------------------------------------

/** One loaded page of a Browse: the items plus pagination cursor info. */
export interface BrowsePage {
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}

/** Load a single page for a context from the live TMDBService. Routes each
 * context kind to its method; `discover` uses a raw `/discover` request so the
 * slideover's extended params apply. */
export async function loadBrowsePage(
  service: TMDBService,
  ctx: BrowseContext,
  page: number,
): Promise<BrowsePage> {
  switch (ctx.kind) {
    case "category": {
      const result =
        ctx.category === "trending"
          ? await service.getTrending(ctx.type, "week", page)
          : await service.getCategory(ctx.category, ctx.type, page);
      return toPage(result);
    }
    case "genre": {
      const result = await service.discover(
        ctx.type,
        makeDiscoverFilters({ genreId: ctx.genreId, page }),
      );
      return toPage(result);
    }
    case "search": {
      const result = await service.search(ctx.query, ctx.type, page);
      return toPage(result);
    }
    case "discover": {
      // Use the extended discover request so the full filter set applies.
      const result = await service.discoverWithParams(
        ctx.type,
        buildDiscoverParams(ctx.type, ctx.filters, page),
      );
      return toPage(result);
    }
  }
}

/** Server Mode equivalent of loadBrowsePage. The server owns the TMDB key and
 * executes the same route mapping under the signed-in profile. */
export async function loadServerBrowsePage(
  ctx: BrowseContext,
  page: number,
): Promise<BrowsePage> {
  switch (ctx.kind) {
    case "category": {
      const result = await fetchServerCategory({
        type: ctx.type,
        category: ctx.category,
        page,
      });
      return toPage(result);
    }
    case "genre": {
      const result = await discoverServerMedia({
        type: ctx.type,
        params: buildDiscoverParams(
          ctx.type,
          { ...emptyBrowseFilters(), genreIds: [ctx.genreId] },
          page,
        ),
      });
      return toPage(result);
    }
    case "search": {
      const result = await searchServerMedia({
        query: ctx.query,
        type: ctx.type,
        page,
      });
      return toPage(result);
    }
    case "discover": {
      const result = await discoverServerMedia({
        type: ctx.type,
        params: buildDiscoverParams(ctx.type, ctx.filters, page),
      });
      return toPage(result);
    }
  }
}

function toPage(result: {
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}): BrowsePage {
  return {
    items: result.items,
    page: result.page,
    totalPages: result.totalPages,
    totalResults: result.totalResults,
  };
}

// ---- No-key fixture fallback ------------------------------------------------

/** All fixture previews flattened (used as the no-key browse corpus). */
function fixtureCorpus(): MediaPreview[] {
  const f = loadDiscoverFixtures();
  // Dedup by id (the same title can appear in multiple fixture rails).
  const seen = new Map<string, MediaPreview>();
  for (const item of [
    ...f.trendingMovies,
    ...f.popularMovies,
    ...f.topRatedMovies,
    ...f.nowPlayingMovies,
    ...f.upcomingMovies,
    ...f.trendingTV,
  ]) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

/** Filter the bundled fixtures for a context so the screen renders without a
 * key. Single page (no live pagination); sorting honors the draft's sortBy. */
export function fixtureBrowsePage(ctx: BrowseContext): BrowsePage {
  let items = fixtureCorpus();

  switch (ctx.kind) {
    case "category":
    case "genre":
    case "discover":
      items = items.filter((i) => i.type === ctx.type);
      break;
    case "search": {
      const q = ctx.query.trim().toLowerCase();
      items = items.filter(
        (i) =>
          (ctx.type == null || i.type === ctx.type) &&
          i.title.toLowerCase().includes(q),
      );
      break;
    }
  }

  if (ctx.kind === "discover") {
    items = sortPreviews(items, ctx.filters.sortBy);
    if (ctx.filters.minRating != null) {
      items = items.filter((i) => (i.imdbRating ?? 0) >= ctx.filters.minRating!);
    }
    // Mirror the live discover path: clamp implausible years, then order an
    // inverted range before filtering.
    const [yearGTE, yearLTE] = orderYearBounds(
      plausibleYear(ctx.filters.yearGTE),
      plausibleYear(ctx.filters.yearLTE),
    );
    if (yearGTE != null) {
      items = items.filter((i) => (i.year ?? 0) >= yearGTE);
    }
    if (yearLTE != null) {
      items = items.filter((i) => (i.year ?? 9999) <= yearLTE);
    }
  }

  return {
    items,
    page: 1,
    totalPages: 1,
    totalResults: items.length,
  };
}

/** Sort a preview list by a `SortOption` (the subset that makes sense on the
 * fixture corpus: rating, release date/year, title). Popularity falls back to
 * the fixture order. */
export function sortPreviews(
  items: MediaPreview[],
  sortBy: SortOption,
): MediaPreview[] {
  const copy = [...items];
  switch (sortBy) {
    case SortOption.ratingDesc:
      return copy.sort((a, b) => (b.imdbRating ?? 0) - (a.imdbRating ?? 0));
    case SortOption.ratingAsc:
      return copy.sort((a, b) => (a.imdbRating ?? 0) - (b.imdbRating ?? 0));
    case SortOption.releaseDateDesc:
      return copy.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case SortOption.releaseDateAsc:
      return copy.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    case SortOption.titleAsc:
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return copy; // popularity.* → keep source order
  }
}

// ---- React hook -------------------------------------------------------------

export type BrowseSource = "live" | "fixtures";

export interface BrowseState {
  items: MediaPreview[];
  loading: boolean;
  /** True while a load-more page is in flight (the first load uses `loading`). */
  loadingMore: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  totalResults: number;
  source: BrowseSource | null;
  /** Whether another page can be requested (page < totalPages, not loading). */
  canLoadMore: boolean;
  /** Append the next page (no-op when none remain or already loading). */
  loadMore: () => void;
}

const EMPTY_STATE: Omit<BrowseState, "loadMore"> = {
  items: [],
  loading: true,
  loadingMore: false,
  error: null,
  page: 0,
  totalPages: 0,
  totalResults: 0,
  source: null,
  canLoadMore: false,
};

/**
 * React hook driving a Browse for a context. Loads page 1 on mount / whenever
 * the context changes, and exposes `loadMore()` for infinite scroll. With a
 * TMDBService it loads live; without one (or on a live error) it falls back to
 * a single fixture page so the screen always renders.
 */
export function useBrowse(
  service: TMDBService | null,
  ctx: BrowseContext,
): BrowseState {
  const [state, setState] = useState<Omit<BrowseState, "loadMore">>(EMPTY_STATE);
  // A stable identity for the context so the effect re-runs only on a real
  // change (the slideover builds a fresh object each Apply).
  const ctxKey = useMemo(() => JSON.stringify(ctx), [ctx]);
  const serverMode = isServerMode();
  // Guard against a stale async append after the context changed.
  const runIdRef = useRef(0);

  // Load page 1 whenever the context changes.
  useEffect(() => {
    const runId = ++runIdRef.current;
    setState({ ...EMPTY_STATE });

    void (async () => {
      if (service == null && !serverMode) {
        const page = fixtureBrowsePage(ctx);
        if (runIdRef.current !== runId) return;
        setState({
          items: page.items,
          loading: false,
          loadingMore: false,
          error: null,
          page: page.page,
          totalPages: page.totalPages,
          totalResults: page.totalResults,
          source: "fixtures",
          canLoadMore: false,
        });
        return;
      }

      try {
        const page = serverMode
          ? await loadServerBrowsePage(ctx, 1)
          : await loadBrowsePage(service!, ctx, 1);
        if (runIdRef.current !== runId) return;
        setState({
          items: page.items,
          loading: false,
          loadingMore: false,
          error: null,
          page: page.page,
          totalPages: page.totalPages,
          totalResults: page.totalResults,
          source: "live",
          canLoadMore: page.page < page.totalPages,
        });
      } catch (err) {
        if (runIdRef.current !== runId) return;
        const fb = fixtureBrowsePage(ctx);
        setState({
          items: fb.items,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : String(err),
          page: fb.page,
          totalPages: fb.totalPages,
          totalResults: fb.totalResults,
          source: "fixtures",
          canLoadMore: false,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, service, serverMode]);

  const loadMore = useCallback(() => {
    setState((prev) => {
      if (
        (service == null && !serverMode) ||
        prev.loading ||
        prev.loadingMore ||
        prev.source !== "live" ||
        prev.page >= prev.totalPages
      ) {
        return prev;
      }

      const runId = runIdRef.current;
      const next = prev.page + 1;

      void (async () => {
        try {
          const page = serverMode
            ? await loadServerBrowsePage(ctx, next)
            : await loadBrowsePage(service!, ctx, next);
          if (runIdRef.current !== runId) return;
          setState((cur) => {
            // De-dup across pages (TMDB can repeat items between pages).
            const seen = new Set(cur.items.map((i) => i.id));
            const merged = [
              ...cur.items,
              ...page.items.filter((i) => !seen.has(i.id)),
            ];
            return {
              ...cur,
              items: merged,
              loadingMore: false,
              page: page.page,
              totalPages: page.totalPages,
              totalResults: page.totalResults,
              canLoadMore: page.page < page.totalPages,
            };
          });
        } catch {
          if (runIdRef.current !== runId) return;
          // Stop trying on an append error, keep what we have.
          setState((cur) => ({ ...cur, loadingMore: false, canLoadMore: false }));
        }
      })();

      return { ...prev, loadingMore: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, service, serverMode]);

  return { ...state, loadMore };
}
