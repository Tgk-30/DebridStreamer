// "Browse categories" tile grid (ported from VPStudio's ExploreGenreGrid).
//
// A deterministic, fast genre entry point: tap a tile to open a Browse pre-set
// to that genre (the `kind:"genre"` browse context) or, for the two special
// tiles, a category Browse (New Releases / Coming Soon). Pure presentational - 
// the caller passes the active media type and the store's `openBrowse`.

import { useEffect, useState } from "react";
import type { BrowseContext } from "../data/browse";
import { catalogTilesFor, tileGenreId, type GenreCatalogTile } from "../data/genreCatalog";
import { useGenreArtwork } from "../data/genreArtwork";
import { fallbackGenres } from "../data/genres";
import { prefersReducedMotion } from "../lib/reducedMotion";
import type { MediaType } from "../models/media";
import type { MetadataProvider } from "../services/metadata/types";
import "./GenreCatalogGrid.css";

interface Props {
  type: MediaType;
  onOpen: (ctx: BrowseContext) => void;
  /** Metadata source for live tile artwork; gradient-only when null. */
  tmdb?: MetadataProvider | null;
}

// A tile cycles through its representative backdrops on this cadence, cross-
// fading between them so the "Browse categories" cards refresh over a session.
const ROTATE_MS = 9000;

/** Two-layer cross-fade over a tile's backdrops. Only two <img>s are ever in the
 * DOM (current + incoming), so a 15-tile grid loads ~30 images, not ~90. The
 * rotation is staggered per tile and suppressed under reduced-motion. */
function GenreTileArt({ urls, index }: { urls: string[]; index: number }) {
  // Two ping-pong layers; `top` says which one is currently visible.
  const [layers, setLayers] = useState<{ a: string; b: string; top: "a" | "b" }>(
    () => ({ a: urls[0], b: urls[0], top: "a" }),
  );

  // Reset when the backdrop set changes (e.g. movie↔series switch or refetch).
  useEffect(() => {
    setLayers({ a: urls[0], b: urls[0], top: "a" });
  }, [urls]);

  useEffect(() => {
    if (urls.length < 2 || prefersReducedMotion()) return;
    let frame = 0;
    let tick: number | undefined;
    // Stagger the first flip so the tiles don't all change at the same instant.
    const kickoff = window.setTimeout(function advance() {
      frame = (frame + 1) % urls.length;
      const next = urls[frame];
      setLayers((L) =>
        L.top === "a" ? { a: L.a, b: next, top: "b" } : { a: next, b: L.b, top: "a" },
      );
      tick = window.setTimeout(advance, ROTATE_MS);
    }, ROTATE_MS + (index % 5) * 1300);
    return () => {
      window.clearTimeout(kickoff);
      window.clearTimeout(tick);
    };
  }, [urls, index]);

  return (
    <span className="genre-tile-arts" aria-hidden>
      <img
        className={"genre-tile-art" + (layers.top === "a" ? " is-current" : "")}
        src={layers.a}
        alt=""
        aria-hidden
        decoding="async"
      />
      <img
        className={"genre-tile-art" + (layers.top === "b" ? " is-current" : "")}
        src={layers.b}
        alt=""
        aria-hidden
        decoding="async"
      />
    </span>
  );
}

export function GenreCatalogGrid({ type, onOpen, tmdb = null }: Props) {
  const tiles = catalogTilesFor(type);
  const artwork = useGenreArtwork(type, tmdb);

  const genreName = (tile: GenreCatalogTile): string => {
    const gid = tileGenreId(tile, type);
    if (gid == null) return tile.label;
    return fallbackGenres(type).find((g) => g.id === gid)?.name ?? tile.label;
  };

  const open = (tile: GenreCatalogTile) => {
    if (tile.category != null) {
      onOpen({ kind: "category", type, category: tile.category });
      return;
    }
    const gid = tileGenreId(tile, type);
    if (gid == null) return;
    onOpen({ kind: "genre", type, genreId: gid, genreName: genreName(tile) });
  };

  return (
    <div className="genre-catalog">
      {tiles.map((t, i) => {
        const art = artwork.get(t.id);
        const hasArt = art != null && art.length > 0;
        return (
          <button
            key={t.id}
            type="button"
            className={"genre-tile" + (hasArt ? " has-art" : "")}
            style={
              {
                "--tile-a": t.accent[0],
                "--tile-b": t.accent[1],
              } as React.CSSProperties
            }
            onClick={() => open(t)}
            aria-label={`Browse ${t.category != null ? t.label : genreName(t)}`}
          >
            {hasArt && <GenreTileArt urls={art} index={i} />}
            <span className="genre-tile-glyph" aria-hidden>
              {t.glyph}
            </span>
            <span className="genre-tile-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
