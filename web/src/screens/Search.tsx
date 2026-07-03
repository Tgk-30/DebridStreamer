// Search screen — fully wired (mirrors the native Search).
//
// A query field + a movie/tv/all type filter. Submitting (or arriving from the
// global search field via the store's pendingSearch) runs TMDBService.search and
// renders the results as a MediaCard grid that opens Detail. The idle state shows
// trending titles as starters. Falls back to bundled fixtures when no TMDB key is
// configured, so the screen renders for a screenshot. TMDBService is read-only.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/AppStore";
import type { MediaPreview, MediaType } from "../models/media";
import { loadDiscoverFixtures } from "../data/fixtures";
import { MediaGrid } from "../components/MediaGrid";
import { GenreCatalogGrid } from "../components/GenreCatalogGrid";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { searchServerMedia } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import "./Search.css";

type TypeFilter = "all" | "movie" | "series";

const FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV" },
];

/** Idle starters from fixtures (used as the no-key fallback too). */
function fixtureStarters(): MediaPreview[] {
  const f = loadDiscoverFixtures();
  return [...f.trendingMovies, ...f.trendingTV];
}

/**
 * Poster-grid skeleton shown while a search is in flight. Mirrors the
 * `.media-grid` results container (same columns/gap) with 2:3 shimmer tiles so
 * real results swap in with no layout shift. Self-contained — not shared.
 */
function SearchSkeleton() {
  return (
    <div
      className="search-skel-grid"
      role="status"
      aria-label="Searching"
      aria-busy="true"
    >
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} className="search-skel" />
      ))}
    </div>
  );
}

export function Search() {
  const {
    services,
    pendingSearch,
    consumePendingSearch,
    openDetail,
    openBrowse,
  } = useAppStore();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [results, setResults] = useState<MediaPreview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const starters = useMemo(() => fixtureStarters(), []);
  const serverMode = isServerMode();

  // Pick up a query handed over from the global search field. The debounce
  // effect below then runs it (no immediate call, so there's no double fetch).
  useEffect(() => {
    if (pendingSearch != null) {
      setQuery(pendingSearch);
      consumePendingSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearch]);

  // Monotonic run id so only the most recent search commits state (stale-
  // response guard; mirrors useBrowse).
  const runIdRef = useRef(0);

  // Live search — results update as you type (debounced), and re-run when the
  // type filter changes. Enter fires an immediate search via the input handler
  // AND cancels this pending timer (debounceRef) so it can't double-fetch.
  const debounceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    debounceRef.current = window.setTimeout(() => void runSearch(query, filter), 300);
    return () => window.clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  async function runSearch(q: string, type: TypeFilter) {
    const trimmed = q.trim();
    if (trimmed.length === 0) {
      runIdRef.current += 1; // cancel any in-flight result
      // Clear loading too: an in-flight run we just superseded will skip its own
      // setLoading(false) (its run id no longer matches), so without this the
      // searching skeleton would stay up forever over the idle view.
      setLoading(false);
      setResults(null);
      return;
    }

    const myRun = ++runIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const tmdbType: MediaType | null = type === "all" ? null : type;
      const result = serverMode
        ? await searchServerMedia({ query: trimmed, type: tmdbType })
        : services.tmdb != null
          ? await services.tmdb.search(trimmed, tmdbType)
          : null;

      if (myRun !== runIdRef.current) return; // superseded by a newer search
      if (result != null) {
        const filtered =
          type === "all"
            ? result.items
            : result.items.filter((i) => i.type === type);
        setResults(filtered);
        return;
      }
    } catch (err) {
      if (myRun !== runIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
      return;
    } finally {
      if (myRun === runIdRef.current) setLoading(false);
    }

    // No key / no server → filter the fixtures locally so the screen still works.
    if (myRun === runIdRef.current && services.tmdb == null && !serverMode) {
      const matches = starters.filter(
        (s) =>
          s.title.toLowerCase().includes(trimmed.toLowerCase()) &&
          (type === "all" || s.type === type),
      );
      setResults(matches);
      setError(null);
      setLoading(false);
    }
  }

  return (
    <div className="search-screen">
      <h1 className="search-h1">Search</h1>

      <div className="search-controls">
        <div className="search-field glass-raised glass-lit field">
          <Icon name="search" size={16} className="t-secondary" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search movies & shows"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Cancel the pending debounce so Enter doesn't double-fetch.
                window.clearTimeout(debounceRef.current);
                void runSearch(query, filter);
              }
            }}
            aria-label="Search movies and shows"
          />
          {query.length > 0 && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                runIdRef.current += 1; // cancel any in-flight result
                setLoading(false); // see runSearch's empty-query branch
                setQuery("");
                setResults(null);
                inputRef.current?.focus();
              }}
              aria-label="Clear"
            >
              <Icon name="xmark" size={16} />
            </button>
          )}
        </div>

        <div className="search-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip${filter === f.id ? " is-active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="search-status search-error">{error}</p>}

      {loading ? (
        <SearchSkeleton />
      ) : results == null ? (
        <section className="search-idle">
          <h2 className="search-section-title">Browse categories</h2>
          <GenreCatalogGrid
            type={filter === "series" ? "series" : "movie"}
            onOpen={openBrowse}
            tmdb={services.tmdb}
          />
          <h2 className="search-section-title search-section-title-spaced">
            Trending now
          </h2>
          <MediaGrid items={starters} onSelect={openDetail} />
        </section>
      ) : (
        <>
          {results.length > 0 && (services.tmdb != null || serverMode) && (
            <div className="search-results-head">
              <h2 className="search-section-title">
                Results for “{query.trim()}”
              </h2>
              <button
                type="button"
                className="search-see-all"
                onClick={() =>
                  openBrowse({
                    kind: "search",
                    type: filter === "all" ? null : filter,
                    query: query.trim(),
                  })
                }
              >
                See all
                <span className="search-see-all-arrow" aria-hidden>
                  ›
                </span>
              </button>
            </div>
          )}
          <MediaGrid
            items={results}
            onSelect={openDetail}
            empty={
              !loading ? (
                <EmptyState
                  icon="search"
                  title="No results"
                  subtitle={`Nothing matched “${query.trim()}”. Try a different title or filter.`}
                />
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}
