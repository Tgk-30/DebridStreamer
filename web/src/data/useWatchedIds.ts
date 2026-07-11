// useWatchedIds - one batched read of the set of fully-watched media ids from
// watch history, for the poster check badge on library surfaces. A single query
// per screen (never per card); re-runs when `refreshKey` changes so a fresh
// completion shows up without a reload. Degrades to an empty set on any failure.

import { useEffect, useState } from "react";
import { getStore } from "../storage";
import { watchedMediaIds } from "./watchedState";

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
