// Loads the full watch history + taste events from the durable Store and
// aggregates them into a WatchStats snapshot for the opt-in insights card.
//
// The AppStore only keeps history as display previews (no durations/timestamps),
// so this reads the complete records straight from the Store. Disabled → no work
// and no snapshot. `deps` re-aggregates when they change — pass the STABLE store
// slices (e.g. [history, continueWatching]) whose identity changes on any refresh,
// so progress to an already-recorded title also re-aggregates, not just new rows.

import { useEffect, useState } from "react";
import { getStore } from "../storage";
import { computeWatchStats, type WatchStats } from "./watchStats";

export function useWatchStats(
  enabled: boolean,
  deps: readonly unknown[] = [],
): WatchStats | null {
  const [stats, setStats] = useState<WatchStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const store = getStore();
        const [records, events] = await Promise.all([
          store.listHistory(500),
          // Server Mode returns no taste events; favorite genres just stay empty.
          store.recentTasteEvents(500).catch(() => []),
        ]);
        if (!cancelled) setStats(computeWatchStats(records, events));
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Spread the caller's stable deps so identity changes (not just length) drive
    // a refresh. Their count is fixed per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return stats;
}
