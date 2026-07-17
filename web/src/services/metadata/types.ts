// Port of Sources/DebridStreamer/Services/Metadata/MetadataProvider.swift:
// the MetadataProvider protocol plus its supporting value types, and a
// TMDBError equivalent (ported from TMDBService.swift).

import type {
  CastMember,
  Episode,
  MediaItem,
  MediaPreview,
  MediaType,
  Season,
} from "../../models/media";

/** Sort options for discover. Mirrors `DiscoverFilters.SortOption`. */
export type SortOption =
  | "popularity.desc"
  | "popularity.asc"
  | "vote_average.desc"
  | "vote_average.asc"
  | "primary_release_date.desc"
  | "primary_release_date.asc"
  | "title.asc";

export const SortOption = {
  popularityDesc: "popularity.desc" as SortOption,
  popularityAsc: "popularity.asc" as SortOption,
  ratingDesc: "vote_average.desc" as SortOption,
  ratingAsc: "vote_average.asc" as SortOption,
  releaseDateDesc: "primary_release_date.desc" as SortOption,
  releaseDateAsc: "primary_release_date.asc" as SortOption,
  titleAsc: "title.asc" as SortOption,

  displayName(option: SortOption): string {
    switch (option) {
      case "popularity.desc":
        return "Most Popular";
      case "popularity.asc":
        return "Least Popular";
      case "vote_average.desc":
        return "Highest Rated";
      case "vote_average.asc":
        return "Lowest Rated";
      case "primary_release_date.desc":
        return "Newest";
      case "primary_release_date.asc":
        return "Oldest";
      case "title.asc":
        return "Title A-Z";
    }
  },

  allCases(): SortOption[] {
    return [
      "popularity.desc",
      "popularity.asc",
      "vote_average.desc",
      "vote_average.asc",
      "primary_release_date.desc",
      "primary_release_date.asc",
      "title.asc",
    ];
  },
} as const;

/** Filters for content discovery. Mirrors `DiscoverFilters`. */
export interface DiscoverFilters {
  genreId?: number | null;
  year?: number | null;
  minRating?: number | null;
  sortBy: SortOption;
  page: number;
}

/** Mirrors the Swift memberwise init defaults of `DiscoverFilters`. */
export function makeDiscoverFilters(
  partial: Partial<DiscoverFilters> = {},
): DiscoverFilters {
  return {
    genreId: partial.genreId ?? null,
    year: partial.year ?? null,
    minRating: partial.minRating ?? null,
    sortBy: partial.sortBy ?? SortOption.popularityDesc,
    page: partial.page ?? 1,
  };
}

/** A genre for filtering content. Mirrors `Genre`. */
export interface Genre {
  id: number;
  name: string;
}

/** Trending time window. Mirrors `TrendingWindow`. */
export type TrendingWindow = "day" | "week";

export const TrendingWindow = {
  day: "day" as TrendingWindow,
  week: "week" as TrendingWindow,
} as const;

/** Content category for browsing. Mirrors `MediaCategory`. */
export type MediaCategory =
  | "popular"
  | "top_rated"
  | "now_playing"
  | "upcoming"
  | "airing_today"
  | "on_the_air";

export const MediaCategory = {
  popular: "popular" as MediaCategory,
  topRated: "top_rated" as MediaCategory,
  nowPlaying: "now_playing" as MediaCategory,
  upcoming: "upcoming" as MediaCategory,
  airingToday: "airing_today" as MediaCategory,
  onTheAir: "on_the_air" as MediaCategory,

  displayName(category: MediaCategory): string {
    switch (category) {
      case "popular":
        return "Popular";
      case "top_rated":
        return "Top Rated";
      case "now_playing":
        return "Now Playing";
      case "upcoming":
        return "Upcoming";
      case "airing_today":
        return "Airing Today";
      case "on_the_air":
        return "On The Air";
    }
  },

  categories(type: MediaType): MediaCategory[] {
    return type === "movie"
      ? ["popular", "top_rated", "now_playing", "upcoming"]
      : ["popular", "top_rated", "airing_today", "on_the_air"];
  },
} as const;

/** External IDs for a media item. Mirrors `ExternalIds` (imdb_id / tvdb_id). */
export interface ExternalIds {
  imdbId?: string | null;
  tvdbId?: number | null;
}

/** Search result with pagination info. Mirrors `MetadataSearchResult`. */
export interface MetadataSearchResult {
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}

/** Protocol for metadata providers (TMDB, OMDB, etc.). Mirrors `MetadataProvider`. */
export interface MetadataProvider {
  search(
    query: string,
    type: MediaType | null,
    page?: number,
  ): Promise<MetadataSearchResult>;

  getDetail(id: string, type: MediaType): Promise<MediaItem>;

  getTrending(
    type: MediaType,
    timeWindow?: TrendingWindow,
    page?: number,
  ): Promise<MetadataSearchResult>;

  getCategory(
    category: MediaCategory,
    type: MediaType,
    page?: number,
  ): Promise<MetadataSearchResult>;

  discover(
    type: MediaType,
    filters: DiscoverFilters,
  ): Promise<MetadataSearchResult>;

  getGenres(type: MediaType): Promise<Genre[]>;

  getSeasons(tmdbId: number): Promise<Season[]>;

  getEpisodes(tmdbId: number, season: number): Promise<Episode[]>;

  getExternalIds(tmdbId: number, type: MediaType): Promise<ExternalIds>;

  getCast(tmdbId: number, type: MediaType): Promise<CastMember[]>;

  getRecommendations(tmdbId: number, type: MediaType): Promise<MediaPreview[]>;

  /** The YouTube key of the title's best trailer, or null. Optional - callers
   * gate on its presence (Server-Mode metadata providers may omit it). */
  getTrailer?(tmdbId: number, type: MediaType): Promise<string | null>;
}

/**
 * Error kinds returned by the TMDB service. Mirrors Swift `TMDBError`,
 * carrying the same human-facing descriptions via `message`.
 */
type TMDBErrorKind =
  | "invalidURL"
  | "invalidResponse"
  | "unauthorized"
  | "notFound"
  | "rateLimited"
  | "httpError";

export class TMDBError extends Error {
  readonly kind: TMDBErrorKind;
  /** HTTP status code, present for `httpError`. */
  readonly statusCode?: number;

  private constructor(
    kind: TMDBErrorKind,
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "TMDBError";
    this.kind = kind;
    this.statusCode = statusCode;
  }

  static invalidURL(path: string): TMDBError {
    return new TMDBError("invalidURL", `Invalid TMDB URL: ${path}`);
  }
  static invalidResponse(): TMDBError {
    return new TMDBError("invalidResponse", "Invalid response from TMDB");
  }
  static unauthorized(): TMDBError {
    return new TMDBError("unauthorized", "Invalid TMDB API key");
  }
  static notFound(id: string): TMDBError {
    return new TMDBError("notFound", `Not found on TMDB: ${id}`);
  }
  static rateLimited(): TMDBError {
    return new TMDBError(
      "rateLimited",
      "TMDB rate limit exceeded. Try again shortly.",
    );
  }
  static httpError(code: number, body: string): TMDBError {
    return new TMDBError("httpError", `TMDB HTTP ${code}: ${body}`, code);
  }
}
