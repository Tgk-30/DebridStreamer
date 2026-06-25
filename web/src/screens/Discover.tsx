// Discover screen — mirrors Sources/.../Views/Catalog/DiscoverView.swift.
//
// Layout (top → bottom): cinematic HeroSpotlight (first trending item with a
// backdrop) → "Describe a vibe" MoodStrip → horizontal poster Rails (Trending
// Movies, Trending TV, Popular, Top Rated, Now Playing, Upcoming). Data comes
// from the useDiscover() hook (live with a key, fixtures otherwise).

import { useState } from "react";
import type { MediaPreview } from "../models/media";
import { useDiscover } from "../data/discover";
import { useAppStore } from "../store/AppStore";
import { hasResumePoint, watchProgressPercent } from "../storage/models";
import { isServerMode } from "../lib/serverMode";
import { curateServerAI } from "../lib/serverApi";
import {
  emptyBrowseFilters,
  type BrowseContext,
  type BrowseFilters,
} from "../data/browse";
import { SortOption } from "../services/metadata/types";
import type { AIMovieRecommendation } from "../services/ai/models";
import { HeroSpotlight } from "../components/HeroSpotlight";
import { MoodStrip } from "../components/MoodStrip";
import { Rail } from "../components/Rail";
import "./Discover.css";

interface DiscoverProps {
  onSelect?: (item: MediaPreview) => void;
}

function moodBrowseFilters(vibe: string): BrowseFilters {
  const text = vibe.toLowerCase();
  const filters = emptyBrowseFilters();
  const genres = new Set<number>();

  if (/mystery|mysteries|detective|whodunit|noir/.test(text)) genres.add(9648);
  if (/thriller|tense|slow-burn|psychological|suspense/.test(text)) genres.add(53);
  if (/sci-fi|science fiction|space|future|mind-bending|mind bending/.test(text)) {
    genres.add(878);
  }
  if (/road|trip|adventure|quest/.test(text)) genres.add(12);
  if (/feel-good|feel good|comfort|cozy|funny|comedy/.test(text)) genres.add(35);
  if (/animated|animation/.test(text)) genres.add(16);
  if (/family|kids/.test(text)) genres.add(10751);

  filters.genreIds = [...genres];
  if (/2010s|from the 2010s/.test(text)) {
    filters.yearGTE = 2010;
    filters.yearLTE = 2019;
  }
  if (/classic|older|90s|1990s/.test(text)) {
    filters.yearLTE = /90s|1990s/.test(text) ? 1999 : 1989;
  }
  if (/best|great|top|acclaimed|mind-bending|mind bending/.test(text)) {
    filters.minRating = 7;
    filters.sortBy = SortOption.ratingDesc;
  }

  return filters;
}

export function Discover({ onSelect }: DiscoverProps) {
  const { services, openBrowse, continueWatching } = useAppStore();
  const { data, loading } = useDiscover(services.tmdb);

  // Continue Watching — resumable history (>2% and <95%) surfaced at the top of
  // the home, with per-card progress bars. Only renders when there's something
  // to resume, so it never clutters a fresh install.
  const resumable = continueWatching.filter(hasResumePoint);
  const continueItems = resumable.map((r) => r.preview);
  const continueProgress: Record<string | number, number> = {};
  for (const r of resumable) {
    continueProgress[r.preview.id] = watchProgressPercent(r);
  }
  const [moodLoading, setMoodLoading] = useState(false);
  const [moodError, setMoodError] = useState<string | null>(null);
  const [moodStatus, setMoodStatus] = useState<string | null>(null);
  const [moodResults, setMoodResults] = useState<MediaPreview[]>([]);
  const [moodTitle, setMoodTitle] = useState("Mood picks");
  const [moodQuery, setMoodQuery] = useState("");

  // "See all" → open the full paginated Browse for a rail's exact category.
  const seeAll = (ctx: BrowseContext) => () => openBrowse(ctx);
  const heroKey = data?.hero == null ? null : `${data.hero.type}:${data.hero.id}`;
  const withoutHero = (items: MediaPreview[]) =>
    heroKey == null ? items : items.filter((item) => `${item.type}:${item.id}` !== heroKey);

  async function resolveRecommendation(
    rec: AIMovieRecommendation,
  ): Promise<MediaPreview | null> {
    const mediaType = rec.mediaType ?? null;
    if (services.tmdb != null) {
      const result = await services.tmdb.search(rec.title, mediaType, 1);
      const normalizedTitle = rec.title.trim().toLowerCase();
      const sorted = [...result.items].sort((a, b) => {
        const aExact = a.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
        const bExact = b.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
        const aYear = rec.year != null && a.year === rec.year ? 1 : 0;
        const bYear = rec.year != null && b.year === rec.year ? 1 : 0;
        return bExact + bYear - (aExact + aYear);
      });
      return sorted[0] ?? null;
    }

    if (rec.mediaId != null && rec.mediaType != null) {
      return {
        id: rec.mediaId,
        type: rec.mediaType,
        title: rec.title,
        year: rec.year,
        posterPath: rec.posterPath,
      };
    }

    return null;
  }

  async function curateMood(vibe: string) {
    setMoodError(null);
    setMoodStatus(null);
    setMoodResults([]);
    setMoodQuery(vibe);
    setMoodTitle(`Mood picks for “${vibe}”`);

    // Server Mode: the assistant + TMDB keys live on the server, so curate and
    // resolve there and render the returned previews directly.
    if (isServerMode()) {
      setMoodLoading(true);
      try {
        const { items } = await curateServerAI({ prompt: vibe, count: 8 });
        if (items.length === 0) {
          setMoodError("The assistant returned titles, but none could be matched.");
          return;
        }
        setMoodResults(items);
        setMoodStatus(`${items.length} titles matched.`);
      } catch (err) {
        setMoodError(err instanceof Error ? err.message : String(err));
      } finally {
        setMoodLoading(false);
      }
      return;
    }

    if (services.ai == null) {
      setMoodStatus("No AI provider is configured, so this opened a filter-based browse.");
      openBrowse({ kind: "discover", type: "movie", filters: moodBrowseFilters(vibe) });
      return;
    }

    setMoodLoading(true);
    try {
      const result = await services.ai.recommend(vibe, [], 8);
      const resolved = await Promise.all(
        result.recommendations.map((rec) =>
          resolveRecommendation(rec).catch(() => null),
        ),
      );
      const seen = new Set<string>();
      const items = resolved.filter((item): item is MediaPreview => {
        if (item == null) return false;
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (items.length === 0) {
        setMoodError("The assistant returned titles, but none could be matched.");
        return;
      }

      setMoodResults(items);
      setMoodStatus(`${items.length} titles matched.`);
    } catch (err) {
      setMoodError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoodLoading(false);
    }
  }

  if (loading || !data) {
    return <DiscoverSkeleton />;
  }

  return (
    <div className="discover">
      {data.hero && (
        <HeroSpotlight
          items={[data.hero, ...data.trendingMovies, ...data.trendingTV]
            .filter(
              (it, i, arr) =>
                it.backdropPath != null &&
                // Keep the first BACKDROP-having occurrence of each id. Deduping
                // on the first occurrence overall would drop a backdrop version
                // when a backdrop-less duplicate of the same id appeared earlier.
                arr.findIndex(
                  (x) => x.id === it.id && x.backdropPath != null,
                ) === i
            )
            .slice(0, 5)}
          onPlay={onSelect}
          onDetails={onSelect}
        />
      )}

      <Rail
        title="Continue Watching"
        items={continueItems}
        progressById={continueProgress}
        onSelect={onSelect}
      />

      <MoodStrip
        onCurate={curateMood}
        loading={moodLoading}
        status={moodStatus}
        error={moodError}
      />

      <Rail
        title={moodTitle}
        items={moodResults}
        onSelect={onSelect}
        onSeeAll={
          moodResults.length > 0
            ? seeAll({ kind: "search", type: null, query: moodQuery })
            : undefined
        }
      />

      <Rail
        title="Trending Movies"
        items={withoutHero(data.trendingMovies)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "trending" })}
      />
      <Rail
        title="Trending TV Shows"
        items={withoutHero(data.trendingTV)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "series", category: "trending" })}
      />
      <Rail
        title="Popular Movies"
        items={withoutHero(data.popularMovies)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "popular" })}
      />
      <Rail
        title="Top Rated Movies"
        items={withoutHero(data.topRatedMovies)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "top_rated" })}
      />
      <Rail
        title="Now Playing"
        items={withoutHero(data.nowPlayingMovies)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "now_playing" })}
      />
      <Rail
        title="Upcoming"
        items={withoutHero(data.upcomingMovies)}
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "upcoming" })}
      />
    </div>
  );
}

/** Cold-start skeleton (mirrors DiscoverView.skeletonView): a hero block then a
 * few redacted rails. Purely cosmetic while the first load resolves. */
function DiscoverSkeleton() {
  return (
    <div className="discover">
      <div className="skel-hero glass-rest" />
      {[0, 1, 2].map((r) => (
        <div className="skel-rail" key={r}>
          <div className="skel-title" />
          <div className="skel-cards">
            {[0, 1, 2, 3, 4, 5].map((c) => (
              <div className="skel-card glass-rest" key={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
