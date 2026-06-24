// FilterSlideover — the advanced Browse filter panel.
//
// A glass panel that slides in from the right to refine Browse results. Edits a
// DRAFT copy of the filters (a BrowseFilters) so changing controls does not
// live-requery; "Apply" hands the draft back to Browse (which rebuilds the
// discover context and re-runs page 1), "Clear" resets the draft to empty.
//
// Controls: media type (movie/tv), multi-select genres (from useGenres),
// release-year range, min vote average + min vote count, max runtime, original
// language, and sort. Accent is used only for selected/active state.

import { useEffect, useState } from "react";
import type { MediaType } from "../models/media";
import { useAppStore } from "../store/AppStore";
import { useGenres } from "../data/genres";
import {
  type BrowseFilters,
  emptyBrowseFilters,
  hasActiveFilters,
  plausibleYear,
} from "../data/browse";
import { SortOption } from "../services/metadata/types";
import { Icon } from "./Icon";
import "./FilterSlideover.css";

interface FilterSlideoverProps {
  open: boolean;
  /** The currently-applied type + filters (seed the draft from these). */
  type: MediaType;
  filters: BrowseFilters;
  onClose: () => void;
  /** Apply: hand back the (possibly type-changed) draft. */
  onApply: (type: MediaType, filters: BrowseFilters) => void;
}

const SORTS: { id: SortOption; label: string }[] = [
  { id: SortOption.popularityDesc, label: "Popularity" },
  { id: SortOption.releaseDateDesc, label: "Newest" },
  { id: SortOption.ratingDesc, label: "Rating" },
  { id: SortOption.titleAsc, label: "Title A–Z" },
];

const LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Any" },
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
];

const RATINGS = [5, 6, 7, 8, 9];
const VOTE_FLOORS = [
  { value: null as number | null, label: "Any" },
  { value: 100, label: "100+" },
  { value: 500, label: "500+" },
  { value: 1000, label: "1k+" },
];
const RUNTIMES = [
  { value: null as number | null, label: "Any" },
  { value: 90, label: "≤ 90m" },
  { value: 120, label: "≤ 2h" },
  { value: 150, label: "≤ 2.5h" },
];

export function FilterSlideover({
  open,
  type,
  filters,
  onClose,
  onApply,
}: FilterSlideoverProps) {
  const { services } = useAppStore();
  const [draftType, setDraftType] = useState<MediaType>(type);
  const [draft, setDraft] = useState<BrowseFilters>(filters);

  // Re-seed the draft from the applied filters whenever the panel (re)opens, so
  // a cancelled edit is discarded and the draft reflects what's actually live.
  useEffect(() => {
    if (open) {
      setDraftType(type);
      setDraft(filters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const genres = useGenres(services.tmdb, draftType);

  function patch(next: Partial<BrowseFilters>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function toggleGenre(id: number) {
    setDraft((d) => ({
      ...d,
      genreIds: d.genreIds.includes(id)
        ? d.genreIds.filter((g) => g !== id)
        : [...d.genreIds, id],
    }));
  }

  function changeType(next: MediaType) {
    // A type switch invalidates genre ids (movie vs tv lists differ). The
    // runtime filter is movie-only (TMDB with_runtime applies to movies), so
    // drop it when switching away from movie to avoid leaking it into TV.
    setDraftType(next);
    setDraft((d) => ({
      ...d,
      genreIds: [],
      runtimeLTE: next === "movie" ? d.runtimeLTE : null,
    }));
  }

  const dirty = draftType !== type || hasActiveFilters(draft);

  return (
    <div
      className={`fs-scrim${open ? " is-open" : ""}`}
      onClick={onClose}
      aria-hidden={!open}
    >
      <aside
        className={`fs-panel glass-raised glass-lit${open ? " is-open" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Filters"
        aria-modal="true"
      >
        <header className="fs-head">
          <h2 className="fs-title">Filters</h2>
          <button
            type="button"
            className="fs-close"
            onClick={onClose}
            aria-label="Close filters"
          >
            <Icon name="xmark" size={18} />
          </button>
        </header>

        <div className="fs-body">
          {/* Media type */}
          <FilterGroup label="Type">
            <div className="fs-row">
              {(["movie", "series"] as MediaType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip${draftType === t ? " is-active fs-chip-active" : ""}`}
                  onClick={() => changeType(t)}
                  aria-pressed={draftType === t}
                >
                  {t === "movie" ? "Movies" : "TV"}
                </button>
              ))}
            </div>
          </FilterGroup>

          {/* Sort */}
          <FilterGroup label="Sort by">
            <div className="fs-row fs-wrap">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${draft.sortBy === s.id ? " is-active fs-chip-active" : ""}`}
                  onClick={() => patch({ sortBy: s.id })}
                  aria-pressed={draft.sortBy === s.id}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </FilterGroup>

          {/* Genres (multi-select) */}
          <FilterGroup label="Genres">
            <div className="fs-row fs-wrap">
              {genres.map((g) => {
                const on = draft.genreIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`chip${on ? " is-active fs-chip-active" : ""}`}
                    onClick={() => toggleGenre(g.id)}
                    aria-pressed={on}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </FilterGroup>

          {/* Release-year range */}
          <FilterGroup label="Release year">
            <div className="fs-range">
              <input
                type="number"
                className="fs-num glass-rest"
                placeholder="From"
                inputMode="numeric"
                value={draft.yearGTE ?? ""}
                onChange={(e) =>
                  patch({ yearGTE: parseYear(e.target.value) })
                }
                aria-label="Release year from"
              />
              <span className="fs-range-dash t-secondary">–</span>
              <input
                type="number"
                className="fs-num glass-rest"
                placeholder="To"
                inputMode="numeric"
                value={draft.yearLTE ?? ""}
                onChange={(e) =>
                  patch({ yearLTE: parseYear(e.target.value) })
                }
                aria-label="Release year to"
              />
            </div>
          </FilterGroup>

          {/* Min rating */}
          <FilterGroup label="Min rating">
            <div className="fs-row fs-wrap">
              <button
                type="button"
                className={`chip${draft.minRating == null ? " is-active fs-chip-active" : ""}`}
                onClick={() => patch({ minRating: null })}
                aria-pressed={draft.minRating == null}
              >
                Any
              </button>
              {RATINGS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip${draft.minRating === r ? " is-active fs-chip-active" : ""}`}
                  onClick={() => patch({ minRating: r })}
                  aria-pressed={draft.minRating === r}
                >
                  <Icon name="star" size={11} className="t-warning" />
                  {r}+
                </button>
              ))}
            </div>
          </FilterGroup>

          {/* Min vote count */}
          <FilterGroup label="Min votes">
            <div className="fs-row fs-wrap">
              {VOTE_FLOORS.map((v) => (
                <button
                  key={v.label}
                  type="button"
                  className={`chip${draft.minVotes === v.value ? " is-active fs-chip-active" : ""}`}
                  onClick={() => patch({ minVotes: v.value })}
                  aria-pressed={draft.minVotes === v.value}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </FilterGroup>

          {/* Runtime (movies only — TMDB with_runtime applies to movies) */}
          {draftType === "movie" && (
            <FilterGroup label="Max runtime">
              <div className="fs-row fs-wrap">
                {RUNTIMES.map((rt) => (
                  <button
                    key={rt.label}
                    type="button"
                    className={`chip${draft.runtimeLTE === rt.value ? " is-active fs-chip-active" : ""}`}
                    onClick={() => patch({ runtimeLTE: rt.value })}
                    aria-pressed={draft.runtimeLTE === rt.value}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>
            </FilterGroup>
          )}

          {/* Original language */}
          <FilterGroup label="Language" className="fs-language-group">
            <div className="fs-row fs-wrap">
              {LANGUAGES.map((l) => {
                const on = (draft.originalLanguage ?? "") === l.code;
                return (
                  <button
                    key={l.code || "any"}
                    type="button"
                    className={`chip${on ? " is-active fs-chip-active" : ""}`}
                    onClick={() =>
                      patch({ originalLanguage: l.code === "" ? null : l.code })
                    }
                    aria-pressed={on}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </FilterGroup>
        </div>

        <footer className="fs-foot">
          <button
            type="button"
            className="btn fs-clear"
            onClick={() => {
              setDraft(emptyBrowseFilters());
            }}
            disabled={!hasActiveFilters(draft)}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-prominent fs-apply"
            onClick={() =>
              dirty ? onApply(draftType, sanitizeFilters(draft)) : onClose()
            }
          >
            {dirty ? "Apply filters" : "Done"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function FilterGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`fs-group${className ? ` ${className}` : ""}`}>
      <h3 className="fs-group-label t-secondary">{label}</h3>
      {children}
    </section>
  );
}

/** Sanitize a draft before it's committed as the live filters: drop an
 * implausible/partial year (the permissive input may hold "20" mid-type) so the
 * applied filters never carry a year that buildDiscoverParams would clamp away —
 * which would otherwise show a "From 20" chip that doesn't actually filter. */
export function sanitizeFilters(draft: BrowseFilters): BrowseFilters {
  return {
    ...draft,
    yearGTE: plausibleYear(draft.yearGTE),
    yearLTE: plausibleYear(draft.yearLTE),
  };
}

/** Parse a year from an input value; empty/non-numeric → null. Permissive on
 *  purpose: these feed a *controlled* number input, so a partial entry (the "2",
 *  "20", "201" a user types before reaching "2010") must round-trip unchanged or
 *  the keystroke is erased and the field becomes impossible to type into. The
 *  plausibility clamp (a 1-3 digit value would build a malformed "20-01-01" date
 *  param) lives in buildDiscoverParams, applied only when the range is used. */
function parseYear(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}
