// Genre catalog tiles - the "Browse categories" entry grid.
//
// Ported from VPStudio's ExploreGenreCatalog: a fixed set of mood/genre tiles
// plus two special "New Releases" / "Coming Soon" tiles. Tapping a genre tile
// opens a Browse pre-set to that genre (the previously-unused `kind:"genre"`
// browse context); the special tiles open a category Browse. Genre ids are the
// canonical TMDB ids (a single source of truth with data/genres.ts); a tile is
// hidden for a media type when that type has no matching genre.

import type { MediaType } from "../models/media";
import type { MediaCategory } from "../services/metadata/types";

export interface GenreCatalogTile {
  id: string;
  /** Short display label (the canonical TMDB name is used for the Browse title). */
  label: string;
  /** Decorative watermark glyph (no icon asset dependency). */
  glyph: string;
  /** Two-stop accent gradient (theme rgba strings). */
  accent: [string, string];
  /** TMDB movie genre id, or null when this genre doesn't apply to movies. */
  movieGenreId: number | null;
  /** TMDB TV genre id, or null when this genre doesn't apply to TV. */
  tvGenreId: number | null;
  /** Set for the special category tiles (New Releases / Coming Soon). */
  category?: MediaCategory;
}

const A = {
  purple: "rgba(140, 133, 250, 0.55)",
  blue: "rgba(92, 189, 250, 0.55)",
  pink: "rgba(250, 117, 189, 0.55)",
  green: "rgba(92, 217, 140, 0.5)",
  amber: "rgba(250, 184, 92, 0.5)",
  red: "rgba(250, 115, 115, 0.5)",
  teal: "rgba(92, 217, 207, 0.5)",
  indigo: "rgba(120, 120, 250, 0.55)",
};

export const GENRE_CATALOG: GenreCatalogTile[] = [
  { id: "action", label: "Action", glyph: "💥", accent: [A.red, A.amber], movieGenreId: 28, tvGenreId: 10759 },
  { id: "comedy", label: "Comedy", glyph: "😂", accent: [A.amber, A.pink], movieGenreId: 35, tvGenreId: 35 },
  { id: "drama", label: "Drama", glyph: "🎭", accent: [A.purple, A.indigo], movieGenreId: 18, tvGenreId: 18 },
  { id: "scifi", label: "Sci-Fi", glyph: "🚀", accent: [A.blue, A.indigo], movieGenreId: 878, tvGenreId: 10765 },
  { id: "horror", label: "Horror", glyph: "👻", accent: [A.indigo, A.purple], movieGenreId: 27, tvGenreId: null },
  { id: "thriller", label: "Thriller", glyph: "🔪", accent: [A.red, A.purple], movieGenreId: 53, tvGenreId: null },
  { id: "romance", label: "Romance", glyph: "💘", accent: [A.pink, A.red], movieGenreId: 10749, tvGenreId: null },
  { id: "fantasy", label: "Fantasy", glyph: "🐉", accent: [A.teal, A.green], movieGenreId: 14, tvGenreId: 10765 },
  { id: "animation", label: "Animation", glyph: "🐾", accent: [A.green, A.teal], movieGenreId: 16, tvGenreId: 16 },
  { id: "crime", label: "Crime", glyph: "🕵️", accent: [A.indigo, A.blue], movieGenreId: 80, tvGenreId: 80 },
  { id: "mystery", label: "Mystery", glyph: "🔍", accent: [A.purple, A.blue], movieGenreId: 9648, tvGenreId: 9648 },
  { id: "documentary", label: "Documentary", glyph: "🎥", accent: [A.teal, A.blue], movieGenreId: 99, tvGenreId: 99 },
  { id: "family", label: "Family", glyph: "🧸", accent: [A.amber, A.green], movieGenreId: 10751, tvGenreId: 10751 },
  // Special category tiles.
  { id: "new-releases", label: "New Releases", glyph: "✨", accent: [A.blue, A.purple], movieGenreId: null, tvGenreId: null, category: "now_playing" as MediaCategory },
  { id: "coming-soon", label: "Coming Soon", glyph: "🗓️", accent: [A.pink, A.purple], movieGenreId: null, tvGenreId: null, category: "upcoming" as MediaCategory },
];

/** The genre id for a tile under a media type (null when it doesn't apply).
 * `MediaType` is "movie" | "series" - anything non-movie maps to the TV id. */
export function tileGenreId(tile: GenreCatalogTile, type: MediaType): number | null {
  return type === "movie" ? tile.movieGenreId : tile.tvGenreId;
}

/** Tiles that should render for a media type: every special tile, plus genre
 * tiles that have an id for that type. */
export function catalogTilesFor(type: MediaType): GenreCatalogTile[] {
  return GENRE_CATALOG.filter((t) => t.category != null || tileGenreId(t, type) != null);
}
