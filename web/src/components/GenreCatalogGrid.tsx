// "Browse categories" tile grid (ported from VPStudio's ExploreGenreGrid).
//
// A deterministic, fast genre entry point: tap a tile to open a Browse pre-set
// to that genre (the `kind:"genre"` browse context) or, for the two special
// tiles, a category Browse (New Releases / Coming Soon). Pure presentational —
// the caller passes the active media type and the store's `openBrowse`.

import type { BrowseContext } from "../data/browse";
import { catalogTilesFor, tileGenreId, type GenreCatalogTile } from "../data/genreCatalog";
import { fallbackGenres } from "../data/genres";
import type { MediaType } from "../models/media";
import "./GenreCatalogGrid.css";

interface Props {
  type: MediaType;
  onOpen: (ctx: BrowseContext) => void;
}

export function GenreCatalogGrid({ type, onOpen }: Props) {
  const tiles = catalogTilesFor(type);

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
    <div className="genre-catalog" role="list">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          role="listitem"
          className="genre-tile"
          style={
            {
              "--tile-a": t.accent[0],
              "--tile-b": t.accent[1],
            } as React.CSSProperties
          }
          onClick={() => open(t)}
          aria-label={`Browse ${t.category != null ? t.label : genreName(t)}`}
        >
          <span className="genre-tile-glyph" aria-hidden>
            {t.glyph}
          </span>
          <span className="genre-tile-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
