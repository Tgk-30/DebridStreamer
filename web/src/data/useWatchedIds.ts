// useWatchedIds - one batched read of the set of fully-watched media ids from
// watch history, for the poster check badge on library surfaces. A single query
// per screen (never per card); re-runs when `refreshKey` changes so a fresh
// completion shows up without a reload. Degrades to an empty set on any failure.

import { useEffect, useState } from "react";
import { getStore } from "../storage";
import {
  watchedEpisodeIdsForMedia,
  watchedMediaIds,
  watchedStateForRecord,
} from "./watchedState";

const EMPTY: ReadonlySet<string> = new Set<string>();

export function useWatchedIds(refreshKey: unknown = 0): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    void getStore()
      .listHistory()
      .then((records) => {
        if (!cancelled) setIds(watchedMediaIds(records));
      })
      .catch(() => {
        if (!cancelled) setIds(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return ids;
}

export interface DetailWatchedState {
  /** Fully completed episode rows for this exact series. */
  episodeIds: ReadonlySet<string>;
  /** The completed movie row for this exact title. */
  movieWatched: boolean;
}

const EMPTY_DETAIL: DetailWatchedState = {
  episodeIds: EMPTY,
  movieWatched: false,
};

/** Detail-local watched state. Movies use an exact keyed lookup. Series use a
 * complete per-media history query so global history caps cannot hide older
 * completed episodes. */
export function useDetailWatchedState(
  mediaId: string | null | undefined,
  mediaType: "movie" | "series" | null | undefined,
  refreshKey: unknown = 0,
): DetailWatchedState {
  const [state, setState] = useState<DetailWatchedState>(EMPTY_DETAIL);

  useEffect(() => {
    if (mediaId == null || mediaType == null) {
      setState(EMPTY_DETAIL);
      return;
    }
    let cancelled = false;
    setState(EMPTY_DETAIL);
    const store = getStore();
    const load =
      mediaType === "movie"
        ? store.getResume(mediaId, null).then((movieRecord) => ({
            episodeIds: EMPTY,
            movieWatched: watchedStateForRecord(movieRecord) === "watched",
          }))
        : store.listHistoryForMedia(mediaId).then((records) => ({
            episodeIds: watchedEpisodeIdsForMedia(records, mediaId),
            movieWatched: false,
          }));
    void load
      .then((next) => {
        if (cancelled) return;
        setState(next);
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY_DETAIL);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaType, refreshKey]);

  return state;
}
