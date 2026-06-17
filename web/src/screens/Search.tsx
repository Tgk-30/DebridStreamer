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
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
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

export function Search() {
  const { services, pendingSearch, consumePendingSearch, openDetail } =
    useAppStore();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [results, setResults] = useState<MediaPreview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const starters = useMemo(() => fixtureStarters(), []);

  // Pick up a query handed over from the global search field.
  useEffect(() => {
    if (pendingSearch != null) {
      setQuery(pendingSearch);
      void runSearch(pendingSearch, filter);
      consumePendingSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearch]);

  // Re-run when the type filter changes (if there's an active query).
  useEffect(() => {
    if (query.trim().length > 0 && results != null) {
      void runSearch(query, filter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function runSearch(q: string, type: TypeFilter) {
    const trimmed = q.trim();
    if (trimmed.length === 0) {
      setResults(null);
      return;
    }

    // No key → filter the fixtures locally so the screen still works.
    if (services.tmdb == null) {
      const matches = starters.filter(
        (s) =>
          s.title.toLowerCase().includes(trimmed.toLowerCase()) &&
          (type === "all" || s.type === type),
      );
      setResults(matches);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const tmdbType: MediaType | null = type === "all" ? null : type;
      const result = await services.tmdb.search(trimmed, tmdbType);
      const filtered =
        type === "all"
          ? result.items
          : result.items.filter((i) => i.type === type);
      setResults(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
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
              if (e.key === "Enter") void runSearch(query, filter);
            }}
            aria-label="Search movies and shows"
          />
          {query.length > 0 && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
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

      {loading && (
        <p className="search-status t-secondary">Searching…</p>
      )}
      {error && <p className="search-status search-error">{error}</p>}

      {results == null ? (
        <section className="search-idle">
          <h2 className="search-section-title">Trending now</h2>
          <MediaGrid items={starters} onSelect={openDetail} />
        </section>
      ) : (
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
      )}
    </div>
  );
}
