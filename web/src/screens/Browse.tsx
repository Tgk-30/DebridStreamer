// Browse screen - paginated "See all" grid + advanced filters.
//
// Mounts as an overlay (like Detail) whenever the store has a `browseContext`.
// Renders a MediaCard grid for the active context - a category (trending/
// popular/top-rated/…), a single genre, a free-text search, or a full
// `discover` filter set - with load-more / infinite scroll (append pages until
// totalPages), loading/empty states, and tapping a card opens its Detail.
//
// The "Filters" button opens the FilterSlideover. Applying refines the context
// into a `discover` target (carrying the chosen type + filters) and re-runs
// page 1. Active filters show as removable chips above the grid. Data comes from
// the read-only useBrowse() hook; it gates gracefully without a TMDB key.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/AppStore";
import {
  type BrowseContext,
  type BrowseFilters,
  browseTitle,
  emptyBrowseFilters,
  hasActiveFilters,
  useBrowse,
} from "../data/browse";
import { genreName, useGenres } from "../data/genres";
import { SortOption } from "../services/metadata/types";
import type { MediaType } from "../models/media";
import { MediaCard } from "../components/MediaCard";
import { VirtualMediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import "./Browse.css";

// The advanced filter panel is code-split out of the Browse chunk; it only
// mounts the first time the user opens it (kept mounted afterwards so it can
// animate closed).
const FilterSlideover = lazy(() =>
  import("../components/FilterSlideover").then((m) => ({
    default: m.FilterSlideover,
  })),
);

export function Browse() {
  const { browseContext, closeBrowse, openDetail } = useAppStore();
  // A local working copy so the slideover can refine the context without round-
  // tripping through the store (the store just holds the initial target).
  const [ctx, setCtx] = useState<BrowseContext | null>(browseContext);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Re-seed when the store hands us a new target (a different "See all").
  useEffect(() => {
    setCtx(browseContext);
    setFiltersOpen(false);
  }, [browseContext]);

  if (ctx == null) return null;
  return (
    <BrowseInner
      ctx={ctx}
      setCtx={setCtx}
      filtersOpen={filtersOpen}
      setFiltersOpen={setFiltersOpen}
      onClose={closeBrowse}
      onSelect={openDetail}
    />
  );
}

interface BrowseInnerProps {
  ctx: BrowseContext;
  setCtx: (ctx: BrowseContext) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  onClose: () => void;
  onSelect: (item: import("../models/media").MediaPreview) => void;
}

function BrowseInner({
  ctx,
  setCtx,
  filtersOpen,
  setFiltersOpen,
  onClose,
  onSelect,
}: BrowseInnerProps) {
  const { services } = useAppStore();
  const state = useBrowse(services.tmdb, ctx);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Only pull in the (code-split) FilterSlideover chunk once the user has opened
  // the panel at least once; keep it mounted thereafter so it animates closed.
  const [filtersMounted, setFiltersMounted] = useState(false);
  useEffect(() => {
    if (filtersOpen) setFiltersMounted(true);
  }, [filtersOpen]);

  // The type + filters the slideover edits. Seed from the active context: a
  // discover context carries them; other kinds start blank (applying converts
  // them into a discover context).
  const draftType: MediaType = ctxType(ctx);
  const draftFilters: BrowseFilters =
    ctx.kind === "discover" ? ctx.filters : emptyBrowseFilters();

  // Genre list for labeling active-filter chips (live or static fallback).
  const genres = useGenres(services.tmdb, draftType);

  // Infinite scroll: observe a sentinel below the grid; load the next page when
  // it scrolls into view. Falls back to the explicit "Load more" button too.
  useEffect(() => {
    const node = sentinelRef.current;
    if (node == null || !state.canLoadMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) state.loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [state.canLoadMore, state.loadMore, state.items.length]);

  function applyFilters(type: MediaType, filters: BrowseFilters) {
    setFiltersOpen(false);
    if (hasActiveFilters(filters)) {
      setCtx({ kind: "discover", type, filters });
    } else {
      // Cleared everything → fall back to a plain "popular" category browse.
      setCtx({ kind: "category", type, category: "popular" });
    }
  }

  const title = browseTitle(ctx);
  const activeChips = ctx.kind === "discover" ? chipsFor(ctx.filters, genres) : [];
  const filtersActive = ctx.kind === "discover" && hasActiveFilters(ctx.filters);

  return (
    <div className={`browse${filtersOpen ? " has-filters-open" : ""}`}>
      <div className="browse-inner">
        <header className="browse-head">
          <button
            type="button"
            className="browse-back"
            onClick={onClose}
            aria-label="Back"
          >
            <span className="browse-back-arrow" aria-hidden>
              ‹
            </span>
            Back
          </button>

          <div className="browse-title-row">
            <h1 className="browse-h1">{title}</h1>
            {state.totalResults > 0 && state.source === "live" && (
              <span className="browse-count t-secondary">
                {state.totalResults.toLocaleString()} titles
              </span>
            )}
          </div>

          <button
            type="button"
            className={`btn browse-filter-btn${filtersActive ? " browse-filter-on" : ""}`}
            onClick={() => setFiltersOpen(true)}
          >
            <Icon name="sliders" size={15} />
            Filters
          </button>
        </header>

        {state.source === "fixtures" && ctx.kind === "genre" && (
          <p className="browse-fixture-note t-secondary">
            Showing sample titles - genre filtering needs a TMDB key (Settings →
            API keys).
          </p>
        )}

        {activeChips.length > 0 && (
          <div className="browse-chips" aria-label="Active filters">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="chip browse-chip"
                onClick={() =>
                  ctx.kind === "discover" &&
                  setCtx({
                    kind: "discover",
                    type: ctx.type,
                    filters: chip.remove(ctx.filters),
                  })
                }
                title={`Remove ${chip.label}`}
              >
                {chip.label}
                <Icon name="xmark" size={13} />
              </button>
            ))}
            <button
              type="button"
              className="browse-chip-clear t-secondary"
              onClick={() =>
                ctx.kind === "discover" &&
                setCtx({ kind: "category", type: ctx.type, category: "popular" })
              }
            >
              Clear all
            </button>
          </div>
        )}

        {state.loading ? (
          <BrowseSkeleton />
        ) : state.items.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing here"
            subtitle="No titles matched this view. Try different filters or a broader search."
          />
        ) : (
          <>
            <VirtualMediaGrid
              items={state.items}
              className="browse-grid"
              renderItem={(item) => <MediaCard item={item} onSelect={onSelect} />}
            />

            {/* Infinite-scroll sentinel + an explicit fallback button. */}
            <div ref={sentinelRef} className="browse-sentinel" />
            {state.canLoadMore && (
              <div className="browse-more">
                <button
                  type="button"
                  className="btn"
                  onClick={state.loadMore}
                  disabled={state.loadingMore}
                >
                  {state.loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
            {state.loadingMore && (
              <p className="browse-loading t-secondary">Loading more…</p>
            )}
          </>
        )}
      </div>

      {filtersMounted && (
        <Suspense fallback={null}>
          <FilterSlideover
            open={filtersOpen}
            type={draftType}
            filters={draftFilters}
            onClose={() => setFiltersOpen(false)}
            onApply={applyFilters}
          />
        </Suspense>
      )}
    </div>
  );
}

/** A removable active-filter chip: a label + a reducer that drops it. */
interface ActiveChip {
  key: string;
  label: string;
  remove: (f: BrowseFilters) => BrowseFilters;
}

const SORT_LABELS: Partial<Record<SortOption, string>> = {
  [SortOption.releaseDateDesc]: "Newest",
  [SortOption.ratingDesc]: "Highest rated",
  [SortOption.titleAsc]: "Title A–Z",
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
};

/** Build the removable chip descriptors for a discover filter set. */
function chipsFor(
  f: BrowseFilters,
  genres: { id: number; name: string }[],
): ActiveChip[] {
  const chips: ActiveChip[] = [];

  for (const id of f.genreIds) {
    chips.push({
      key: `genre-${id}`,
      label: genreName(genres, id),
      remove: (cur) => ({
        ...cur,
        genreIds: cur.genreIds.filter((g) => g !== id),
      }),
    });
  }
  if (f.yearGTE != null || f.yearLTE != null) {
    const label =
      f.yearGTE != null && f.yearLTE != null
        ? `${f.yearGTE}–${f.yearLTE}`
        : f.yearGTE != null
          ? `From ${f.yearGTE}`
          : `Until ${f.yearLTE}`;
    chips.push({
      key: "year",
      label,
      remove: (cur) => ({ ...cur, yearGTE: null, yearLTE: null }),
    });
  }
  if (f.minRating != null) {
    chips.push({
      key: "rating",
      label: `${f.minRating}+ rating`,
      remove: (cur) => ({ ...cur, minRating: null }),
    });
  }
  if (f.minVotes != null) {
    chips.push({
      key: "votes",
      label: `${f.minVotes}+ votes`,
      remove: (cur) => ({ ...cur, minVotes: null }),
    });
  }
  if (f.runtimeLTE != null) {
    chips.push({
      key: "runtime",
      label: `≤ ${f.runtimeLTE}m`,
      remove: (cur) => ({ ...cur, runtimeLTE: null }),
    });
  }
  if (f.originalLanguage != null) {
    chips.push({
      key: "lang",
      label: LANG_LABELS[f.originalLanguage] ?? f.originalLanguage.toUpperCase(),
      remove: (cur) => ({ ...cur, originalLanguage: null }),
    });
  }
  if (f.sortBy !== SortOption.popularityDesc) {
    const label = SORT_LABELS[f.sortBy] ?? SortOption.displayName(f.sortBy);
    chips.push({
      key: "sort",
      label,
      remove: (cur) => ({ ...cur, sortBy: SortOption.popularityDesc }),
    });
  }
  return chips;
}

function ctxType(ctx: BrowseContext): MediaType {
  if (ctx.kind === "search") return ctx.type ?? "movie";
  return ctx.type;
}

/** A redacted grid while page 1 resolves (mirrors the Discover skeleton look). */
function BrowseSkeleton() {
  return (
    <div className="browse-grid">
      {Array.from({ length: 18 }).map((_, i) => (
        <div className="browse-skel glass-rest" key={i} />
      ))}
    </div>
  );
}
