// External ratings row (IMDb / Rotten Tomatoes / Metacritic) from OMDb.
//
// Two key sources, chosen by mode (the user never has to think about it):
//   • Local / public: the user's own OMDb key (Settings → OMDB) builds
//     services.omdb (an OMDBService that calls OMDb directly — BYOK).
//   • Server "hidden key": when no client key is set and the server advertises
//     the OMDb proxy, fetch via /api/omdb — the server holds the key (a baked
//     limited-distribution key or a per-profile/server credential) and returns
//     only the parsed ratings, so the key is never shipped to or sniffable from
//     the client.
// Renders nothing when no key is available or OMDb has no ratings for the title.

import { useEffect, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useOmdbProxy } from "../lib/ServerSessionContext";
import { isServerMode } from "../lib/serverMode";
import { fetchServerOmdb } from "../lib/serverApi";
import type { OMDBRatings } from "../services/metadata/OMDBService";
import "./OmdbRatings.css";

export function OmdbRatings({ imdbId }: { imdbId: string | null }) {
  const { services } = useAppStore();
  const omdbProxy = useOmdbProxy();
  const [ratings, setRatings] = useState<OMDBRatings | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRatings(null);
    if (imdbId == null) return;

    const load = async (): Promise<OMDBRatings | null> => {
      // BYOK client key takes precedence (the user's own personal key).
      if (services.omdb != null) {
        try {
          return await services.omdb.fetchRatings(imdbId);
        } catch {
          return null;
        }
      }
      // Otherwise the server "hidden key" proxy, when available.
      if (isServerMode() && omdbProxy) {
        try {
          return await fetchServerOmdb(imdbId);
        } catch {
          return null;
        }
      }
      return null;
    };

    void load().then((r) => {
      if (!cancelled) setRatings(r);
    });
    return () => {
      cancelled = true;
    };
  }, [imdbId, services.omdb, omdbProxy]);

  if (ratings == null) return null;
  const items = [
    ratings.imdbRating != null
      ? { key: "imdb", label: "IMDb", value: ratings.imdbRating.toFixed(1) }
      : null,
    ratings.rtPercent != null
      ? { key: "rt", label: "Rotten Tomatoes", value: `${ratings.rtPercent}%` }
      : null,
    ratings.metascore != null
      ? { key: "meta", label: "Metacritic", value: String(ratings.metascore) }
      : null,
  ].filter((x): x is { key: string; label: string; value: string } => x != null);
  if (items.length === 0) return null;

  return (
    <div className="omdb-ratings" aria-label="External ratings">
      {items.map((it) => (
        <span key={it.key} className={`omdb-rating omdb-rating-${it.key}`}>
          <span className="omdb-rating-value">{it.value}</span>
          <span className="omdb-rating-label">{it.label}</span>
        </span>
      ))}
    </div>
  );
}
