// Discover screen — mirrors Sources/.../Views/Catalog/DiscoverView.swift.
//
// Layout (top → bottom): cinematic HeroSpotlight (first trending item with a
// backdrop) → Continue Watching banner rail → horizontal poster Rails (Top 10
// Movies/TV, Popular, Top Rated, Now Playing, Upcoming). Data comes from the
// useDiscover() hook (live with a key, fixtures otherwise). "Describe a vibe"
// now lives on the Search screen.

import type { MediaPreview } from "../models/media";
import { useDiscover } from "../data/discover";
import { useAppStore } from "../store/AppStore";
import { hasResumePoint } from "../storage/models";
import { type BrowseContext } from "../data/browse";
import { HeroSpotlight } from "../components/HeroSpotlight";
import { ContinueWatchingRail } from "../components/ContinueWatchingRail";
import { Rail } from "../components/Rail";
import "./Discover.css";

interface DiscoverProps {
  onSelect?: (item: MediaPreview) => void;
}

export function Discover({ onSelect }: DiscoverProps) {
  const { services, openBrowse, openDetail, continueWatching } = useAppStore();
  const { data, loading } = useDiscover(services.tmdb);

  // Continue Watching — resumable history (>2% and <95%) surfaced at the top of
  // the home as wide banner cards. Only renders when there's something to resume,
  // so it never clutters a fresh install.
  const resumable = continueWatching.filter(hasResumePoint);

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
                // Keep the first BACKDROP-having occurrence of each title. Key on
                // type+id (a movie and a TV show can share a numeric TMDB id) and
                // on backdrop presence, so a backdrop-less duplicate appearing
                // earlier doesn't drop the backdrop version.
                arr.findIndex(
                  (x) =>
                    x.type === it.type &&
                    x.id === it.id &&
                    x.backdropPath != null,
                ) === i
            )
            .slice(0, 5)}
          onPlay={onSelect}
          onDetails={onSelect}
        />
      )}

      {resumable.length > 0 && (
        <ContinueWatchingRail records={resumable} onResume={openDetail} />
      )}

      <Rail
        title="Top 10 Movies"
        items={data.trendingMovies}
        ranked
        onSelect={onSelect}
        onSeeAll={seeAll({ kind: "category", type: "movie", category: "trending" })}
      />
      <Rail
        title="Top 10 TV Shows"
        items={data.trendingTV}
        ranked
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
