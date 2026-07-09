// Genre list for the Browse filter slideover.
//
// Live: TMDBService.getGenres(type) (already TTL-cached 24h inside the service).
// No key: a static fallback of the canonical TMDB genre lists so the multi-
// select still populates without an API key. TMDBService is read-only.

import { useEffect, useState } from "react";
import type { MediaType } from "../models/media";
import type { Genre } from "../services/metadata/types";
import type { TMDBService } from "../services/metadata/TMDBService";
import { fetchServerGenres } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";

/** Canonical TMDB movie genre ids/names (the static no-key fallback). */
const MOVIE_GENRES: Genre[] = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

/** Canonical TMDB TV genre ids/names (the static no-key fallback). */
const TV_GENRES: Genre[] = [
  { id: 10759, name: "Action & Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 10762, name: "Kids" },
  { id: 9648, name: "Mystery" },
  { id: 10763, name: "News" },
  { id: 10764, name: "Reality" },
  { id: 10765, name: "Sci-Fi & Fantasy" },
  { id: 10766, name: "Soap" },
  { id: 10767, name: "Talk" },
  { id: 10768, name: "War & Politics" },
  { id: 37, name: "Western" },
];

/** The static fallback list for a media type (also the live initial value, so
 * the slideover never renders an empty genre column while live loads). */
export function fallbackGenres(type: MediaType): Genre[] {
  return type === "movie" ? MOVIE_GENRES : TV_GENRES;
}

/** Resolve the genre name for an id within a type's list (live OR fallback) - 
 * used to label active-filter chips. Falls back to "Genre {id}" if unknown. */
export function genreName(genres: Genre[], id: number): string {
  return genres.find((g) => g.id === id)?.name ?? `Genre ${id}`;
}

/** React hook returning the genre list for a media type. Seeds with the static
 * fallback for an instant render, then swaps in the live list when available. */
export function useGenres(
  service: TMDBService | null,
  type: MediaType,
): Genre[] {
  const [genres, setGenres] = useState<Genre[]>(() => fallbackGenres(type));

  useEffect(() => {
    // Reset to the type's fallback immediately on a type switch.
    setGenres(fallbackGenres(type));
    if (isServerMode()) {
      let cancelled = false;
      void fetchServerGenres(type)
        .then((live) => {
          if (!cancelled && live.length > 0) setGenres(live);
        })
        .catch(() => {
          // Keep the fallback on any failure.
        });
      return () => {
        cancelled = true;
      };
    }
    if (service == null) return;

    let cancelled = false;
    void service
      .getGenres(type)
      .then((live) => {
        if (!cancelled && live.length > 0) setGenres(live);
      })
      .catch(() => {
        // Keep the fallback on any failure.
      });
    return () => {
      cancelled = true;
    };
  }, [service, type]);

  return genres;
}
