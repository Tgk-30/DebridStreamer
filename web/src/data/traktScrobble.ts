// Fire-and-forget Trakt scrobbling for real player lifecycle events.
//
// The players call this module only for start, a user pause, and stop. It never
// sits in a progress writer, and every rejection is contained here so playback
// remains unaffected when Trakt, storage, or the keychain is unavailable.

import { isServerMode } from "../lib/serverMode";
import { TraktSyncService } from "../services/sync/TraktSyncService";
import type { TraktScrobbleItem } from "../services/sync/models";
import { getValidAccessToken, isTraktConnected } from "./traktConnection";

export interface TraktScrobbleContext {
  tmdbId: number;
  type: "movie" | "series";
  season?: number | null;
  episode?: number | null;
  /** The player supplies this for start/resume so Trakt gets the actual media
   * position without adding an asynchronous call to the playback path. */
  progressPct?: number;
}

export interface TraktScrobbleConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

type PlaybackState = "started" | "paused" | "stopped";

const service = new TraktSyncService();
const connectionCacheMs = 5_000;
let config: TraktScrobbleConfig = {
  enabled: false,
  clientId: "",
  clientSecret: "",
};
let connectionCache: {
  value: boolean;
  expiresAt: number;
  pending: Promise<boolean> | null;
} = {
  value: false,
  expiresAt: 0,
  pending: null,
};
const playbackStates = new Map<string, PlaybackState>();

/** Feed the current in-memory settings into the scrobble gate. Detail does this
 * as it renders the active player, avoiding a settings or keychain read from a
 * player event. */
export function configureTraktScrobble(next: TraktScrobbleConfig): void {
  const changedCredentials =
    config.clientId !== next.clientId || config.clientSecret !== next.clientSecret;
  config = {
    enabled: next.enabled,
    clientId: next.clientId,
    clientSecret: next.clientSecret,
  };
  if (changedCredentials || !next.enabled) {
    connectionCache = { value: false, expiresAt: 0, pending: null };
  }
}

/** Mark a real playback start. Repeated play events are ignored until a pause or
 * stop, while a pause then resume produces a new Trakt start event. */
export function scrobblePlaybackStart(ctx: TraktScrobbleContext): void {
  if (!canStartWork()) return;
  const key = contextKey(ctx);
  if (key == null || playbackStates.get(key) === "started") return;
  playbackStates.set(key, "started");
  send("start", ctx, ctx.progressPct ?? 0);
}

/** Report a user pause only after playback has started. */
export function scrobblePlaybackPause(
  ctx: TraktScrobbleContext,
  progressPct: number,
): void {
  if (!canStartWork()) return;
  const key = contextKey(ctx);
  if (key == null || playbackStates.get(key) !== "started") return;
  playbackStates.set(key, "paused");
  send("pause", ctx, progressPct);
}

/** Report player close, unmount, or natural end. A second close after natural
 * end is ignored so the player can safely call this from both event and cleanup
 * paths. */
export function scrobblePlaybackStop(
  ctx: TraktScrobbleContext,
  progressPct: number,
): void {
  if (!canStartWork()) return;
  const key = contextKey(ctx);
  if (key == null || playbackStates.get(key) === "stopped") return;
  playbackStates.set(key, "stopped");
  send("stop", ctx, progressPct);
}

function canStartWork(): boolean {
  return config.enabled && !isServerMode();
}

function contextKey(ctx: TraktScrobbleContext): string | null {
  if (!Number.isInteger(ctx.tmdbId) || ctx.tmdbId <= 0) return null;
  if (ctx.type === "movie") return `movie:${ctx.tmdbId}`;
  if (
    !Number.isInteger(ctx.season) ||
    !Number.isInteger(ctx.episode) ||
    (ctx.season ?? 0) < 0 ||
    (ctx.episode ?? 0) < 1
  ) {
    return null;
  }
  return `series:${ctx.tmdbId}:${ctx.season}:${ctx.episode}`;
}

function itemFor(
  ctx: TraktScrobbleContext,
  progressPct: number,
): TraktScrobbleItem | null {
  if (contextKey(ctx) == null) return null;
  const progress = clampProgress(progressPct);
  if (ctx.type === "movie") {
    return { type: "movie", tmdbID: ctx.tmdbId, progress };
  }
  return {
    type: "episode",
    tmdbID: ctx.tmdbId,
    season: ctx.season!,
    episode: ctx.episode!,
    progress,
  };
}

function clampProgress(progressPct: number): number {
  if (!Number.isFinite(progressPct)) return 0;
  return Math.min(100, Math.max(0, progressPct));
}

function send(
  action: "start" | "pause" | "stop",
  ctx: TraktScrobbleContext,
  progressPct: number,
): void {
  const item = itemFor(ctx, progressPct);
  if (item == null) return;
  void sendSafely(action, item).catch((error) => {
    // eslint-disable-next-line no-console
    console.debug("[trakt] scrobble failed", error);
  });
}

async function sendSafely(
  action: "start" | "pause" | "stop",
  item: TraktScrobbleItem,
): Promise<void> {
  if (!canStartWork()) return;
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();
  if (clientId.length === 0 || clientSecret.length === 0) return;
  if (!(await cachedConnection())) return;
  const accessToken = await getValidAccessToken(service, clientId, clientSecret);
  if (accessToken == null) return;
  if (action === "start") {
    await service.scrobbleStart(clientId, accessToken, item);
  } else if (action === "pause") {
    await service.scrobblePause(clientId, accessToken, item);
  } else {
    await service.scrobbleStop(clientId, accessToken, item);
  }
}

function cachedConnection(): Promise<boolean> {
  if (connectionCache.expiresAt > Date.now()) {
    return Promise.resolve(connectionCache.value);
  }
  if (connectionCache.pending != null) return connectionCache.pending;
  const pending = isTraktConnected()
    .then((value) => {
      connectionCache = {
        value,
        expiresAt: Date.now() + connectionCacheMs,
        pending: null,
      };
      return value;
    })
    .catch((error) => {
      connectionCache = { value: false, expiresAt: 0, pending: null };
      throw error;
    });
  connectionCache.pending = pending;
  return pending;
}
