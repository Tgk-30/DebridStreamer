// useTrailer — loads the YouTube trailer key for a title from TMDB. Mirrors the
// useSeasons degrade-to-null contract: no tmdbId, no provider, no getTrailer
// support, or any failure all resolve to `key: null` (the Detail screen simply
// hides the "Watch trailer" button). Server Mode has no trailer endpoint yet, so
// it degrades to null there too.

import { useEffect, useState } from "react";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { MediaType } from "../models/media";

export interface TrailerState {
  key: string | null;
  loading: boolean;
}

interface TrailerInternal extends TrailerState {
  tmdbId: number | null;
  type: MediaType | null;
}

export function useTrailer(
  tmdbId: number | null,
  type: MediaType | null,
  tmdb: TMDBService | null,
): TrailerState {
  const [state, setState] = useState<TrailerInternal>(() => ({
    tmdbId,
    type,
    key: null,
    loading: false,
  }));

  useEffect(() => {
    if (tmdbId == null || type == null || tmdb?.getTrailer == null) {
      setState({ tmdbId, type, key: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ tmdbId, type, key: null, loading: true });
    const getTrailer = tmdb.getTrailer.bind(tmdb);
    void (async () => {
      try {
        const key = await getTrailer(tmdbId, type);
        if (!cancelled) setState({ tmdbId, type, key, loading: false });
      } catch {
        if (!cancelled) setState({ tmdbId, type, key: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tmdbId, type, tmdb]);

  // Guard the one render between a prop change and the effect re-running: never
  // expose the previous title's key for the new title.
  if (state.tmdbId !== tmdbId || state.type !== type) {
    return { key: null, loading: true };
  }
  return { key: state.key, loading: state.loading };
}
