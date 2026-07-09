// Detail-screen data layer.
//
// Loads the full MediaItem (overview/genres/runtime/imdb id), the cast, and the
// "more like this" recommendations for a selected MediaPreview — live via the
// shared TMDBService when configured, else a graceful fixtures/empty fallback so
// the Detail screen still renders for a screenshot without a key. Imports the
// ported TMDBService READ-ONLY.

import { useEffect, useState } from "react";
import type { CastMember, MediaItem, MediaPreview } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";
import { fetchServerDetail } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";

export interface DetailData {
  item: MediaItem | null;
  cast: CastMember[];
  related: MediaPreview[];
  /** IMDb id (tt…) when known — needed by the indexer search. */
  imdbId: string | null;
}

export interface DetailState {
  data: DetailData;
  loading: boolean;
  error: string | null;
  /** "live" when TMDB produced it, "fixtures" for the no-key fallback. */
  source: "live" | "fixtures";
}

/** Build a usable MediaItem straight from a preview (no network) for the
 * fixtures/no-key path so the hero still renders title/year/rating/poster. */
function previewToItem(p: MediaPreview): MediaItem {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    year: p.year ?? null,
    posterPath: p.posterPath ?? null,
    backdropPath: p.backdropPath ?? null,
    overview: null,
    genres: [],
    imdbRating: p.imdbRating ?? null,
    rtRating: null,
    runtime: null,
    status: null,
    tmdbId: p.tmdbId ?? null,
    lastFetched: new Date().toISOString(),
  };
}

async function loadLive(
  service: TMDBService,
  preview: MediaPreview,
): Promise<DetailData> {
  const tmdbId =
    preview.tmdbId ??
    (preview.id.startsWith("tmdb-")
      ? Number.parseInt(preview.id.slice(5), 10)
      : null);

  const detail = await service.getDetail(preview.id, preview.type);

  // Cast + recommendations need the numeric TMDB id.
  let cast: CastMember[] = [];
  let related: MediaPreview[] = [];
  if (tmdbId != null && !Number.isNaN(tmdbId)) {
    [cast, related] = await Promise.all([
      service.getCast(tmdbId, preview.type).catch(() => []),
      service.getRecommendations(tmdbId, preview.type).catch(() => []),
    ]);
  }

  // The detail id is an IMDb id (tt…) when TMDB had one, else a tmdb- fallback.
  let imdbId = detail.id.startsWith("tt") ? detail.id : null;
  // Fallback: the detail payload's appended external_ids sometimes lacks
  // imdb_id (notably TV) — try the dedicated external_ids endpoint before
  // settling for null, because a null imdb id means the STREAM SEARCH NEVER
  // RUNS for this title (the silent "no streams found" P0).
  if (imdbId == null && tmdbId != null && !Number.isNaN(tmdbId)) {
    try {
      const ids = await service.getExternalIds(tmdbId, preview.type);
      if (ids.imdbId != null && ids.imdbId.startsWith("tt")) {
        imdbId = ids.imdbId;
      }
    } catch {
      // Best-effort — the picker now tells the user when the id is missing.
    }
  }

  return { item: detail, cast, related, imdbId };
}

/** Resolve the detail data for a selected preview. */
export function useDetail(
  preview: MediaPreview | null,
  service: TMDBService | null,
): DetailState {
  const [state, setState] = useState<DetailState>({
    data: { item: null, cast: [], related: [], imdbId: null },
    loading: true,
    error: null,
    source: "fixtures",
  });

  useEffect(() => {
    if (preview == null) return;
    const currentPreview = preview;
    let cancelled = false;

    setState({
      data: {
        item: previewToItem(currentPreview),
        cast: [],
        related: [],
        // IMDb-rooted previews (tt…) can start the stream search immediately,
        // in parallel with the metadata load.
        imdbId: currentPreview.id.startsWith("tt") ? currentPreview.id : null,
      },
      loading: true,
      error: null,
      source: "fixtures",
    });

    async function run() {
      if (isServerMode()) {
        try {
          const data = await fetchServerDetail({
            id: currentPreview.id,
            type: currentPreview.type,
          });
          if (!cancelled) {
            setState({ data, loading: false, error: null, source: "live" });
          }
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!cancelled) {
            setState({
              data: {
                item: previewToItem(currentPreview),
                cast: [],
                related: [],
                // Catalog previews are often IMDb-rooted (tt…) — pass the id
                // through so series/stream search works without TMDB.
                imdbId: currentPreview.id.startsWith("tt") ? currentPreview.id : null,
              },
              loading: false,
              error: message,
              source: "fixtures",
            });
          }
          return;
        }
      }

      if (service == null) {
        if (!cancelled) {
          setState({
            data: {
              item: previewToItem(currentPreview),
              cast: [],
              related: [],
              imdbId: currentPreview.id.startsWith("tt") ? currentPreview.id : null,
            },
            loading: false,
            error: null,
            source: "fixtures",
          });
        }
        return;
      }

      try {
        const data = await loadLive(service, currentPreview);
        if (!cancelled) {
          setState({ data, loading: false, error: null, source: "live" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setState({
            data: {
              item: previewToItem(currentPreview),
              cast: [],
              related: [],
              imdbId: currentPreview.id.startsWith("tt") ? currentPreview.id : null,
            },
            loading: false,
            error: message,
            source: "fixtures",
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [preview, service]);

  return state;
}
