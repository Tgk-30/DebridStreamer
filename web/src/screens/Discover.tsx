// Discover screen — mirrors Sources/.../Views/Catalog/DiscoverView.swift.
//
// Layout (top → bottom): cinematic HeroSpotlight (first trending item with a
// backdrop) → "Describe a vibe" MoodStrip → horizontal poster Rails (Trending
// Movies, Trending TV, Popular, Top Rated, Now Playing, Upcoming). Data comes
// from the useDiscover() hook (live with a key, fixtures otherwise).

import type { MediaPreview } from "../models/media";
import { useDiscover } from "../data/discover";
import { useAppStore } from "../store/AppStore";
import type { BrowseContext } from "../data/browse";
import { HeroSpotlight } from "../components/HeroSpotlight";
import { MoodStrip } from "../components/MoodStrip";
import { Rail } from "../components/Rail";
import "./Discover.css";

interface DiscoverProps {
  onSelect?: (item: MediaPreview) => void;
}

export function Discover({ onSelect }: DiscoverProps) {
  const { services, openBrowse } = useAppStore();
  const { data, loading } = useDiscover(services.tmdb);

  // "See all" → open the full paginated Browse for a rail's exact category.
  const seeAll = (ctx: BrowseContext) => () => openBrowse(ctx);
  const heroKey = data?.hero == null ? null : `${data.hero.type}:${data.hero.id}`;
  const withoutHero = (items: MediaPreview[]) =>
    heroKey == null ? items : items.filter((item) => `${item.type}:${item.id}` !== heroKey);

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
                arr.findIndex((x) => x.id === it.id) === i
            )
            .slice(0, 5)}
          onPlay={onSelect}
          onDetails={onSelect}
        />
      )}

      <MoodStrip
        onCurate={() => {
          /* Visual-only this phase — AIAssistantManager wiring lands later. */
        }}
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
      <div className="skel-hero glass-rest">
        <span className="t-secondary">Loading Discover…</span>
      </div>
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
