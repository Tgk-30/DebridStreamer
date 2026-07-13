// Detail screen - the showcase, fully wired.
//
// Renders for the currently-selected MediaPreview (from the app store):
//   • DetailHero (backdrop + title/meta/overview + Play + Watchlist toggle)
//   • StreamPicker - the cached-on-debrid stream list (green Instant · RD vs grey
//     Will cache), resolving a stream via DebridManager and launching the player.
//   • CastRail (TMDBService.getCast)
//   • "More like this" Rail (TMDBService.getRecommendations) → opens that detail.
//
// Detail metadata loads live via the shared TMDBService when configured, else a
// no-key fallback that still shows the hero. Streams need configured indexers +
// debrid; without them the picker shows a clear empty state.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useDetail } from "../data/detail";
import { useStreams } from "../data/streams";
import {
  defaultSelectionFor,
  episodeIdFor,
  episodeLabel,
  nextEpisodeFor,
  useEpisodes,
  useSeasons,
} from "../data/episodes";
import { filterStreamRows } from "../data/streams";
import { EpisodePicker } from "../components/EpisodePicker";
import { DetailHero, type TasteSignal } from "../components/DetailHero";
import { RatingReveal } from "../components/RatingReveal";
import { DetailAnalysis } from "../components/DetailAnalysis";
import { OmdbRatings } from "../components/OmdbRatings";
import { StreamPicker } from "../components/StreamPicker";
import { CastRail } from "../components/CastRail";
import { TrailerModal } from "../components/TrailerModal";
import { useTrailer } from "../data/trailer";
import { Rail } from "../components/Rail";
import { Spinner } from "../components/Spinner";
import { Icon } from "../components/Icon";
import { isInWatchlist } from "../data/library";
import { VideoCodec, type StreamInfo } from "../services/debrid/models";
import type { TorrentResult } from "../services/indexers/models";
import type { StreamRow } from "../data/streams";
import { createRequest, resolveServerStream } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import { isTauri } from "../lib/tauri";
import type { PlaybackEngine } from "../lib/playbackEngine";
import { getDownloadsBridge } from "../lib/downloadsBridge";
import {
  startDownloadsRuntime,
  type EnqueueDownloadInput,
} from "../services/downloads";
import { useTranscodeAvailable } from "../lib/ServerSessionContext";
import { getStore } from "../storage";
import {
  hasResumePoint,
  watchProgressPercent,
  type PlaybackPrefs,
  type TasteEventType,
} from "../storage/models";
import { watchedStateForRecord, type WatchedState } from "../data/watchedState";
import { rebuildTasteContext } from "../services/ai/TasteProfile";
import "./Detail.css";

// The VideoPlayer pulls in hls.js (large) and only mounts once the user starts
// playback, so it's code-split into its own chunk and kept out of the Detail
// chunk + the initial bundle.
const VideoPlayer = lazy(() =>
  import("../components/VideoPlayer").then((m) => ({ default: m.VideoPlayer })),
);

// Persisted per-title episode selection (see selectEpisode below).
const EPISODE_OVERRIDES_KEY = "ds_episode_overrides";
function loadEpisodeOverrides(): Record<string, { season: number; episode: number }> {
  try {
    const raw = globalThis.localStorage?.getItem(EPISODE_OVERRIDES_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return {};
    // Keep only well-formed entries so poisoned storage can't crash Detail.
    const out: Record<string, { season: number; episode: number }> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const sel = v as { season?: unknown; episode?: unknown };
      if (
        typeof sel?.season === "number" &&
        Number.isInteger(sel.season) &&
        sel.season >= 1 &&
        typeof sel?.episode === "number" &&
        Number.isInteger(sel.episode) &&
        sel.episode >= 1
      ) {
        out[k] = { season: sel.season, episode: sel.episode };
      }
    }
    return out;
  } catch {
    return {};
  }
}

interface ActivePlayer {
  url: string;
  title: string;
  /** Episode context belongs under the show title, never in the media source
   * filename. Null for movies and when metadata is unavailable. */
  subtitle: string | null;
  /** Raw debrid path, visible in Playback information only. */
  sourceFileName: string | null;
  /** Exact renderer selected for this source. Never infer this from the URL in
   * diagnostics: a debrid direct link often has no useful extension. */
  engine: PlaybackEngine;
  /** Original unsupported source used only if native libmpv fails and asks for
   * the safe RD HLS fallback. Null for direct/HLS playback. */
  fallbackStream: StreamInfo | null;
  /** Saved resume position (seconds) to seek to on load; 0 starts fresh. */
  startPositionSeconds: number;
  /** Remembered audio/subtitle/speed for this (media, episode), snapshotted at
   *  play time and restored by the in-window player once tracks load. */
  savedPrefs: PlaybackPrefs | null;
  /** Episode context SNAPSHOTTED at play time (never the live picker
   *  selection) so progress writes + subtitle search track the episode that
   *  is actually playing. All null for movies. */
  episodeId: string | null;
  season: number | null;
  episode: number | null;
}

/** True when the resolved file is a container/codec the webview can't decode
 * directly (MKV/AVI/HEVC/AV1), so it needs either Real-Debrid transcode-to-HLS
 * (in-window) or a native-player hand-off. */
function needsTranscodeOrExternal(
  stream: StreamInfo,
  source?: TorrentResult,
): boolean {
  const name = stream.fileName.toLowerCase();
  const badContainer =
    name.endsWith(".mkv") ||
    name.endsWith(".avi") ||
    name.endsWith(".ts") ||
    name.endsWith(".wmv") ||
    name.endsWith(".flv");
  const parsedCodec = VideoCodec.parse(stream.fileName);
  const badCodec =
    stream.codec === VideoCodec.h265 ||
    stream.codec === VideoCodec.av1 ||
    parsedCodec === VideoCodec.h265 ||
    parsedCodec === VideoCodec.av1 ||
    (source != null &&
      (source.codec === VideoCodec.h265 || source.codec === VideoCodec.av1));
  return badContainer || badCodec;
}

export function Detail() {
  const {
    detailItem,
    closeDetail,
    openDetail,
    navigate,
    services,
    settings,
    watchlist,
    toggleWatchlist,
    recordResume,
    continueWatching,
    refreshContinueWatching,
    cachedResolutions,
  } = useAppStore();
  const transcodeAvailable = useTranscodeAvailable();

  const detail = useDetail(detailItem, services.tmdb);

  // Series episode selection: a user's explicit pick (persisted per title so
  // "I was browsing S3" survives a restart) wins; otherwise default to the
  // most recently watched episode, else S1E1. Movies stay null throughout - 
  // zero behavior change.
  const [episodeOverrides, setEpisodeOverrides] = useState<
    Record<string, { season: number; episode: number }>
  >(() => loadEpisodeOverrides());
  const selectEpisode = (id: string, next: { season: number; episode: number }) => {
    setEpisodeOverrides((m) => {
      const merged = { ...m, [id]: next };
      // Bound the map so storage never balloons. String-key insertion order is
      // spec-guaranteed (media ids are "tmdb-…"/"tt…", never integer-like, so
      // no numeric reordering) - slice(-80) keeps the most recent entries.
      const keys = Object.keys(merged);
      const bounded =
        keys.length > 80
          ? Object.fromEntries(keys.slice(-80).map((k) => [k, merged[k]]))
          : merged;
      try {
        globalThis.localStorage?.setItem(
          EPISODE_OVERRIDES_KEY,
          JSON.stringify(bounded),
        );
      } catch {
        // private mode - session-only is fine
      }
      return bounded;
    });
  };
  const selected = useMemo(
    () =>
      detailItem?.type === "series"
        ? episodeOverrides[detailItem.id] ??
          defaultSelectionFor(detailItem.id, continueWatching)
        : null,
    [detailItem, episodeOverrides, continueWatching],
  );

  const streams = useStreams(
    detail.data.imdbId,
    detailItem?.type ?? "movie",
    selected?.season ?? null,
    selected?.episode ?? null,
    detailItem?.title ?? detail.data.item?.title ?? null,
    services.indexers,
    services.debrid,
  );

  // Per-episode resume bars + watched checks for the picker rows (this series
  // only). `continueWatching` holds ALL history records incl. completed ones.
  const progressByEpisodeId = useMemo(() => {
    if (detailItem?.type !== "series") return {};
    const map: Record<string, number> = {};
    for (const r of continueWatching) {
      if (r.mediaId !== detailItem.id || r.episodeId == null) continue;
      if (!r.completed && hasResumePoint(r)) {
        map[r.episodeId] = watchProgressPercent(r);
      }
    }
    return map;
  }, [detailItem, continueWatching]);
  const watchedEpisodeIds = useMemo(() => {
    if (detailItem?.type !== "series") return new Set<string>();
    return new Set(
      continueWatching
        .filter((r) => r.mediaId === detailItem.id && r.episodeId != null && r.completed)
        .map((r) => r.episodeId as string),
    );
  }, [detailItem, continueWatching]);

  const [player, setPlayer] = useState<ActivePlayer | null>(null);
  const [scrollToStreams, setScrollToStreams] = useState(false);
  // Series show their streams on a dedicated page (opened by picking an
  // episode) instead of inline at the bottom of Detail; movies keep the inline
  // list since they have no episode step.
  const isSeries = detailItem?.type === "series";
  const [streamsPageOpen, setStreamsPageOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadMode, setDownloadMode] = useState<"full" | "optimized">("full");
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || isServerMode()) {
      setFfmpegAvailable(false);
      return;
    }
    let cancelled = false;
    void getDownloadsBridge()
      .downloadsFfmpegAvailable()
      .then((available) => {
        if (!cancelled) setFfmpegAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setFfmpegAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The title's YouTube trailer (null while loading / when TMDB has none). Kept
  // above the early return so hook order stays stable.
  const [trailerOpen, setTrailerOpen] = useState(false);
  const trailer = useTrailer(
    // Prefer the fresh navigation target's id; detail.data.item can lag a title
    // change by a fetch. Falls back to the enriched id when the preview lacks one.
    detailItem?.tmdbId ?? detail.data.item?.tmdbId ?? null,
    detailItem?.type ?? null,
    services.tmdb,
  );

  // ── Next-episode action and auto-advance ──────────────────────────────────
  // The up-next target is computed from the PLAYER SNAPSHOT (never the live
  // picker selection) using TMDB season metadata for season boundaries; a
  // guide-less series falls back to a blind within-season increment inside
  // nextEpisodeFor (harmless: moving to it still requires a cached row).
  const seasonsState = useSeasons(
    detail.data.item?.tmdbId ?? detailItem?.tmdbId ?? null,
    detailItem?.type === "series",
    services.tmdb,
  );
  const selectedSeasonEpisodes = useEpisodes(
    detail.data.item?.tmdbId ?? detailItem?.tmdbId ?? null,
    selected?.season ?? null,
    services.tmdb,
  );
  const upNextTarget = useMemo(
    () =>
      player?.episodeId != null &&
      player.season != null &&
      player.episode != null
        ? nextEpisodeFor(
            { season: player.season, episode: player.episode },
            seasonsState.seasons,
          )
        : null,
    [player, seasonsState.seasons],
  );
  // Pending auto-play for the just-advanced episode. Guards (per the design
  // review): busy ref blocks double-fire from rows-identity churn; the
  // selected-matches-pending gate ensures the stream list is already re-scoped
  // to the new episode; the selectedRef uniqueness check bails if the user
  // manually retargeted mid-resolve.
  const [autoPlayPending, setAutoPlayPending] = useState<{
    season: number;
    episode: number;
  } | null>(null);
  const autoPlayBusy = useRef(false);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const streamsAnchorRef = useRef<HTMLDivElement>(null);
  // Surface the stream list: series open the dedicated page, movies scroll to
  // the inline picker. Used by the hero Watch button and the auto-advance
  // fallback so both honor the same series-vs-movie split.
  const revealStreams = () => {
    if (isSeries) {
      setStreamsPageOpen(true);
    } else {
      streamsAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };
  const streamsBackRef = useRef<HTMLButtonElement>(null);
  // Modal behavior for the episode-streams page: Escape closes it first
  // (capture phase, before Detail's own Escape), focus moves into the page and
  // the detail content behind is inerted so keyboard users can't reach covered
  // controls; focus is restored to the opener on close. While a player is
  // mounted, Escape belongs to the player and this modal behavior is suspended.
  useEffect(() => {
    if (!streamsPageOpen || player != null) return;
    const opener = document.activeElement as HTMLElement | null;
    const inner = rootRef.current?.querySelector<HTMLElement>(".detail-inner");
    inner?.setAttribute("inert", "");
    streamsBackRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setStreamsPageOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      inner?.removeAttribute("inert");
      opener?.focus?.();
    };
  }, [player, streamsPageOpen]);
  useEffect(() => {
    if (autoPlayPending == null || streams.loading || autoPlayBusy.current) return;
    if (
      selected == null ||
      selected.season !== autoPlayPending.season ||
      selected.episode !== autoPlayPending.episode
    ) {
      // The user retargeted before the advanced episode's rows landed - the
      // auto-play intent is stale; cancel it instead of leaving it armed.
      setAutoPlayPending(null);
      return;
    }
    const target = autoPlayPending;
    const row = filterStreamRows(streams.rows, settings).find(
      (r) => r.cachedOn != null,
    );
    setAutoPlayPending(null);
    if (row == null) {
      // Nothing instant for the next episode - land the user on the honest,
      // episode-scoped stream list instead of auto-playing something uncached.
      revealStreams();
      return;
    }
    autoPlayBusy.current = true;
    // Pass the target EXPLICITLY as the file hint - no reliance on which
    // render's `selected` the resolver closure captured.
    resolveSelectedStream(row, target)
      .then((s) => {
        if (
          selectedRef.current?.season !== target.season ||
          selectedRef.current?.episode !== target.episode
        ) {
          return;
        }
        return handlePlay(s, row.result);
      })
      .catch(() => revealStreams())
      .finally(() => {
        autoPlayBusy.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayPending, streams.loading, streams.rows, selected, settings]);

  // A11y: move focus into the overlay on open (so keyboard/screen-reader users
  // land in context) and hand it back to whatever opened the Detail on close.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  // Server Mode "title request" state for this detail. Detail doesn't remount
  // between titles (openDetail just swaps detailItem), so reset on id change.
  const [requestState, setRequestState] = useState<
    "idle" | "requesting" | "requested" | "already"
  >("idle");

  // The user's current like/dislike taste signal for this title, read from the
  // newest taste event for it. Drives the DetailHero thumbs control's active
  // state and toggles off when the same thumb is tapped again.
  const [tasteSignal, setTasteSignal] = useState<TasteSignal>(null);
  // The user's numeric rating for this title, stored NORMALIZED (0–1) so it can
  // be shown on whichever scale (1–10 / 0–100) the user currently prefers.
  const [ratingNorm, setRatingNorm] = useState<number | null>(null);

  const detailId = detailItem?.id ?? null;
  useEffect(() => {
    setRequestState("idle");
  }, [detailId]);

  useEffect(() => {
    // Clear the previous title's signal/rating up front so nothing from the last
    // Detail lingers on screen while this title's events load (or if none exist).
    setTasteSignal(null);
    setRatingNorm(null);
    if (detailId == null) return;
    let cancelled = false;
    void getStore()
      .recentTasteEvents(200)
      .then((events) => {
        if (cancelled) return;
        // The newest of (liked | disliked | not_interested) wins: a later
        // not_interested means the user toggled their thumb back off.
        const latest = events.find(
          (e) =>
            e.mediaId === detailId &&
            (e.eventType === "liked" ||
              e.eventType === "disliked" ||
              e.eventType === "not_interested"),
        );
        setTasteSignal(
          latest?.eventType === "liked"
            ? "liked"
            : latest?.eventType === "disliked"
              ? "disliked"
              : null,
        );
        // Newest "rated" event carries the normalized score in metadata.norm.
        const rated = events.find(
          (e) => e.mediaId === detailId && e.eventType === "rated",
        );
        const norm = rated != null ? Number(rated.metadata?.norm) : NaN;
        // Clamp to [0,1] so a corrupt metadata value can't render 15/10 or 150/100.
        setRatingNorm(
          Number.isFinite(norm) ? Math.min(1, Math.max(0, norm)) : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTasteSignal(null);
          setRatingNorm(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  // Title-level watched state (movies only): the (mediaId, null) history row is
  // read straight from the Store so a completed title reads as "Watched" even
  // though the Continue Watching list excludes finished rows. Series show their
  // watched/in-progress state per episode in the picker instead.
  const detailType = detailItem?.type ?? null;
  const [watchedState, setWatchedState] = useState<WatchedState>("unwatched");
  useEffect(() => {
    setWatchedState("unwatched");
    if (detailId == null || detailType !== "movie") return;
    let cancelled = false;
    void getStore()
      .getResume(detailId, null)
      .then((rec) => {
        if (!cancelled) setWatchedState(watchedStateForRecord(rec));
      })
      .catch(() => {
        if (!cancelled) setWatchedState("unwatched");
      });
    return () => {
      cancelled = true;
    };
  }, [detailId, detailType]);

  if (detailItem == null) return null;

  const item = detail.data.item;
  const currentDetailItem = detailItem;
  const inWatchlist = isInWatchlist(watchlist, detailItem.id);
  // A pre-resolved, ready-to-play stream from the watchlist auto-resolve job.
  // Movie-only: the cache is keyed per TITLE, so instant-playing it for a
  // series could play the wrong episode. Series always go through the picker.
  const cached =
    detailItem.type === "movie" ? cachedResolutions[detailItem.id] ?? null : null;

  /** Resume position (seconds) for the title (movies) or the SELECTED episode
   * (series), read from the already-loaded Continue Watching list
   * (cross-device synced in Server Mode) - 0 when there's no in-progress
   * record or it's completed. */
  function resumeSecondsFor(): number {
    if (detailItem == null) return 0;
    const wantedEpisodeId =
      selected != null ? episodeIdFor(selected.season, selected.episode) : null;
    const record = continueWatching.find(
      (h) => h.mediaId === detailItem.id && h.episodeId === wantedEpisodeId,
    );
    return record != null && !record.completed ? record.progressSeconds : 0;
  }

  /** Remembered audio/subtitle/speed for the title (movies) or SELECTED episode
   * (series), read from the loaded history - restored by the in-window player. */
  function prefsFor(): PlaybackPrefs | null {
    if (detailItem == null) return null;
    const wantedEpisodeId =
      selected != null ? episodeIdFor(selected.season, selected.episode) : null;
    const record = continueWatching.find(
      (h) => h.mediaId === detailItem.id && h.episodeId === wantedEpisodeId,
    );
    if (record == null) return null;
    return {
      preferredAudioId: record.preferredAudioId,
      preferredAudioLang: record.preferredAudioLang,
      preferredSubId: record.preferredSubId,
      playbackSpeed: record.playbackSpeed,
    };
  }

  /** Open the player, seeking to any saved resume position. Snapshots the
   * episode context so a picker change mid-playback can't retarget progress. */
  function openPlayer(
    url: string,
    sourceFileName: string | null,
    engine: PlaybackEngine,
    fallbackStream: StreamInfo | null = null,
  ): void {
    const metadataTitle = item?.title?.trim() || detailItem?.title?.trim() || "";
    const metadataYear = item?.year ?? detailItem?.year ?? null;
    const episodeMetadata =
      selected == null
        ? null
        : selectedSeasonEpisodes.episodes.find(
            (episode) =>
              episode.seasonNumber === selected.season &&
              episode.episodeNumber === selected.episode,
          ) ?? null;
    const episodeContext =
      selected == null
        ? null
        : `${episodeLabel(selected.season, selected.episode)}${
            episodeMetadata?.title?.trim()
              ? ` - ${episodeMetadata.title.trim()}`
              : ""
          }`;
    const title =
      metadataTitle.length > 0
        ? detailItem?.type === "movie" && metadataYear != null
          ? `${metadataTitle} (${metadataYear})`
          : metadataTitle
        : sourceFileName || "Untitled stream";
    setPlayer({
      url,
      title,
      subtitle: detailItem?.type === "series" ? episodeContext : null,
      sourceFileName,
      engine,
      fallbackStream,
      startPositionSeconds: resumeSecondsFor(),
      savedPrefs: prefsFor(),
      episodeId:
        selected != null ? episodeIdFor(selected.season, selected.episode) : null,
      season: selected?.season ?? null,
      episode: selected?.episode ?? null,
    });
  }

  function closePlayer(): void {
    setPlayer(null);
    // WebviewPlayer emits its final progress report from unmount cleanup. Run
    // the one-per-session slice refresh on the next task so that write is
    // registered first; AppStore then waits for it before reading the slice.
    window.setTimeout(() => {
      void refreshContinueWatching();
    }, 0);
  }

  /** Record (or toggle off) a like/dislike taste signal for the current title.
   * The event carries the title + genre names in metadata so the taste-profile
   * assembler can derive liked/disliked genres without a media-cache join. The
   * 24h taste-context cache is rebuilt so the next analysis reflects the change.
   *
   * Tapping the active thumb again toggles it off - recorded as a
   * "not_interested" event so a re-read of the newest signal clears the control
   * (the taste-context assembler ignores not_interested, so it neutralizes the
   * prior like/dislike). */
  function recordTasteSignal(signal: "liked" | "disliked"): void {
    if (detailItem == null) return;
    const next: TasteSignal = tasteSignal === signal ? null : signal;
    setTasteSignal(next);
    const eventType: TasteEventType = next ?? "not_interested";
    const genres = item?.genres ?? [];
    const metadata: Record<string, string> = { title: detailItem.title };
    if (genres.length > 0) metadata.genres = genres.join(", ");
    const store = getStore();
    void store
      .addTasteEvent({
        id: `taste-${detailItem.id}-${Date.now()}`,
        userId: "default",
        mediaId: detailItem.id,
        episodeId: null,
        eventType,
        signalStrength: next === "liked" ? 1 : next === "disliked" ? -1 : 0,
        metadata,
        createdAt: new Date().toISOString(),
      })
      .then(() => rebuildTasteContext(store))
      .catch(() => {
        // best-effort; the in-memory toggle already reflects the user's intent.
      });
  }

  /** Record a numeric rating (1–10 or 0–100). Stored normalized (0–1) in
   *  metadata.norm so it survives a scale change, and fed to the taste profile
   *  as a −1…1 signal (5/10 is neutral). */
  function recordRating(value: number): void {
    if (detailItem == null) return;
    const max = settings.ratingScale === "hundred" ? 100 : 10;
    const norm = Math.min(1, Math.max(0, value / max));
    setRatingNorm(norm);
    const genres = item?.genres ?? [];
    const metadata: Record<string, string> = {
      title: detailItem.title,
      rating: String(value),
      scale: settings.ratingScale,
      norm: norm.toFixed(4),
    };
    if (genres.length > 0) metadata.genres = genres.join(", ");
    const store = getStore();
    void store
      .addTasteEvent({
        id: `taste-${detailItem.id}-${Date.now()}`,
        userId: "default",
        mediaId: detailItem.id,
        episodeId: null,
        eventType: "rated" as TasteEventType,
        signalStrength: norm * 2 - 1,
        metadata,
        createdAt: new Date().toISOString(),
      })
      .then(() => rebuildTasteContext(store))
      .catch(() => {
        // best-effort; the in-memory value already reflects the user's rating.
      });
  }

  /** Remove a previously-given rating. Taste events are append-only, so we record
   * a newest "rated" event with NO norm - the Detail load reads it as "unrated"
   * and the taste profile (newest-per-media) contributes nothing for it, which
   * also suppresses the older score. */
  function clearRating(): void {
    if (detailItem == null) return;
    setRatingNorm(null);
    const store = getStore();
    void store
      .addTasteEvent({
        id: `taste-${detailItem.id}-${Date.now()}`,
        userId: "default",
        mediaId: detailItem.id,
        episodeId: null,
        eventType: "rated" as TasteEventType,
        signalStrength: 0,
        metadata: { title: detailItem.title, cleared: "true" },
        createdAt: new Date().toISOString(),
      })
      .then(() => rebuildTasteContext(store))
      .catch(() => {
        // best-effort; the in-memory value already reflects the cleared rating.
      });
  }

  /** Route one resolved file without hiding the selected engine. Desktop sends
   * unsupported containers/codecs straight to native mpv, preserving 4K DV/HDR
   * and avoiding a lossy RD transcode. Browser sessions still use RD HLS. If the
   * built-in native renderer later fails, VideoPlayer requests HLS lazily using
   * fallbackStream, then retains its external-player error action as the end of
   * the chain. The built-in-player setting remains authoritative inside
   * VideoPlayer: off means native external hand-off, never a silent webview swap. */
  async function playResolvedStream(
    stream: StreamInfo,
    sourceFileName: string | null = stream.fileName,
    source?: TorrentResult,
  ): Promise<void> {
    if (!needsTranscodeOrExternal(stream, source)) {
      openPlayer(stream.streamURL, sourceFileName, "webview-direct");
      return;
    }

    if (isTauri()) {
      openPlayer(stream.streamURL, sourceFileName, "native-mpv", stream);
      return;
    }

    const hlsUrl = await services.debrid?.getTranscodeHLS(stream).catch(() => null);
    if (hlsUrl != null) {
      openPlayer(hlsUrl, sourceFileName, "webview-hls-transcode");
      return;
    }
    openPlayer(stream.streamURL, sourceFileName, "native-mpv");
  }

  /** Play an already-resolved StreamInfo (the instant-play path). */
  async function playStream(stream: StreamInfo) {
    await playResolvedStream(stream, stream.fileName);
  }

  async function resolveSelectedStream(
    row: StreamRow,
    hintOverride?: { season: number; episode: number } | null,
  ): Promise<StreamInfo> {
    // Episode context (series only): steers season-pack torrents to the exact
    // episode's file. Exact single-episode torrents either match (same pick)
    // or carry no tag (fallback to the default pick) - always safe to pass.
    // The auto-advance effect passes its target explicitly (hintOverride) so
    // the hint can never depend on which render's `selected` was captured.
    const fileHint =
      hintOverride ??
      (detailItem?.type === "series" && selected != null
        ? { season: selected.season, episode: selected.episode }
        : null);
    if (isServerMode()) {
      // Request the server's 720p HLS transcode when the user opted in and the
      // server actually supports it; otherwise the plain proxy URL. The title
      // context is required for maturity gating on capped (kid) profiles.
      const media =
        detailItem != null ? { id: detailItem.id, type: detailItem.type } : undefined;
      try {
        return await resolveServerStream(row, {
          transcode: settings.transcode && transcodeAvailable,
          media,
          fileHint,
        });
      } catch (err) {
        // A 403 here means the title is over the active profile's maturity cap.
        // Surface a friendly message (StreamPicker renders the thrown .message)
        // instead of the raw server error, and don't crash the picker.
        if ((err as { status?: number }).status === 403) {
          throw new Error("This title is outside your profile's maturity settings.");
        }
        throw err;
      }
    }
    if (services.debrid == null || !services.debrid.hasServices) {
      throw new Error("Configure a debrid service to play.");
    }
    return services.debrid.resolveStream(row.result.infoHash, row.cachedOn, fileHint);
  }

  /** File a Server-Mode title request for the current item. The detailItem is a
   *  MediaPreview - the same minimal shape watchlist add uses - so it's passed
   *  straight through. A 409 means the title already has a live pending request. */
  async function requestTitle() {
    if (detailItem == null || requestState !== "idle") return;
    setRequestState("requesting");
    try {
      await createRequest(detailItem.id, detailItem);
      setRequestState("requested");
    } catch (err) {
      const status = (err as { status?: number }).status;
      setRequestState(status === 409 ? "already" : "idle");
    }
  }

  /** Advance to the next episode (the Up-next card's action). Closes the
   * player, moves the (persisted) selection - which re-drives the stream
   * search - and queues the auto-play attempt for when the new rows land. */
  function handlePlayNext() {
    if (upNextTarget == null || detailItem == null) return;
    closePlayer();
    selectEpisode(detailItem.id, upNextTarget);
    setAutoPlayPending(upNextTarget);
  }

  async function handlePlay(stream: StreamInfo, source: TorrentResult) {
    await playResolvedStream(stream, stream.fileName || source.title, source);
  }

  const downloadDisabledReason =
    !isTauri()
      ? "Open the desktop app to download files."
      : isServerMode()
        ? "Downloads are available in Local Mode in the desktop app."
        : services.debrid == null || !services.debrid.hasServices
          ? "Add a debrid service in Settings to download."
          : services.indexers == null
            ? "Add a source in Settings to download."
            : null;

  function downloadInput(
    source: TorrentResult,
    episodeContext: { season: number; episode: number; title?: string } | null,
  ): EnqueueDownloadInput {
    const show = item?.title ?? currentDetailItem.title;
    const year = item?.year != null ? ` (${item.year})` : "";
    const episodeTitle = episodeContext?.title?.trim();
    const title =
      episodeContext == null
        ? `${show}${year}`
        : `${show} S${String(episodeContext.season).padStart(2, "0")}E${String(episodeContext.episode).padStart(2, "0")}${episodeTitle ? ` - ${episodeTitle}` : ""}`;
    return {
      mediaId: currentDetailItem.id,
      episodeId:
        episodeContext == null
          ? null
          : episodeIdFor(episodeContext.season, episodeContext.episode),
      title,
      season: episodeContext?.season ?? null,
      episode: episodeContext?.episode ?? null,
      infoHash: source.infoHash,
      fileHint:
        episodeContext == null
          ? null
          : episodeIdFor(episodeContext.season, episodeContext.episode),
      mode: downloadMode,
      optimizeProfile: downloadMode === "optimized" ? "remux" : null,
      // Stream rows do not expose track metadata. Empty means keep all tracks,
      // which is the honest fallback until the native ffprobe pass reports them.
      keepAudioLangs: [],
      keepSubLangs: [],
    };
  }

  async function enqueueCurrentDownload(): Promise<void> {
    const source = filterStreamRows(streams.rows, settings)[0]?.result;
    if (source == null) {
      setDownloadNotice("Find a stream for this title before adding it to the queue.");
      return;
    }
    const episodeContext =
      selected == null ? null : { season: selected.season, episode: selected.episode };
    await startDownloadsRuntime(getStore(), services.debrid).enqueue(
      downloadInput(source, episodeContext),
    );
    setDownloadNotice("Added to Downloads.");
    setDownloadMenuOpen(false);
  }

  async function enqueueEpisodeBatch(
    episodes: Array<{ season: number; episode: number; title?: string }>,
    label: string,
  ): Promise<void> {
    if (services.indexers == null || detail.data.imdbId == null) {
      setDownloadNotice("Add a source and metadata key before creating a batch.");
      return;
    }
    setDownloadNotice(`Finding sources for ${label}…`);
    const matches = await Promise.all(
      episodes.map(async (episode) => {
        const results = await services.indexers!.searchAll(
          detail.data.imdbId!,
          "series",
          episode.season,
          episode.episode,
        );
        const source = results[0];
        return source == null ? null : downloadInput(source, episode);
      }),
    );
    const inputs = matches.filter((input): input is EnqueueDownloadInput => input != null);
    if (inputs.length === 0) {
      setDownloadNotice(`No sources were found for ${label}.`);
      return;
    }
    await startDownloadsRuntime(getStore(), services.debrid).enqueueSeason(inputs);
    const skipped = episodes.length - inputs.length;
    setDownloadNotice(
      skipped > 0
        ? `Added ${inputs.length}; ${skipped} episode${skipped === 1 ? "" : "s"} had no source.`
        : `Added ${inputs.length} episode${inputs.length === 1 ? "" : "s"} to Downloads.`,
    );
    setDownloadMenuOpen(false);
  }

  function enqueueCurrentSeason(): void {
    if (selected == null || selectedSeasonEpisodes.loading) {
      setDownloadNotice("The season guide is still loading.");
      return;
    }
    void enqueueEpisodeBatch(
      selectedSeasonEpisodes.episodes.map((episode) => ({
        season: episode.seasonNumber,
        episode: episode.episodeNumber,
        title: episode.title ?? undefined,
      })),
      `Season ${selected.season}`,
    );
  }

  function enqueueWholeShow(): void {
    if (services.tmdb == null || item?.tmdbId == null || seasonsState.seasons.length === 0) {
      setDownloadNotice("Load the episode guide before downloading the whole show.");
      return;
    }
    setDownloadNotice("Loading the episode guide…");
    void Promise.all(
      seasonsState.seasons.map((season) => services.tmdb!.getEpisodes(item.tmdbId!, season.seasonNumber)),
    ).then((groups) =>
      enqueueEpisodeBatch(
        groups.flat().map((episode) => ({
          season: episode.seasonNumber,
          episode: episode.episodeNumber,
          title: episode.title ?? undefined,
        })),
        "the whole show",
      ),
    ).catch(() => setDownloadNotice("The episode guide could not be loaded."));
  }

  return (
    <div className="detail" ref={rootRef} tabIndex={-1}>
      <div className="detail-inner">
      {item && (
        <DetailHero
          item={item}
          inWatchlist={inWatchlist}
          onClose={closeDetail}
          onToggleWatchlist={() => toggleWatchlist(detailItem)}
          onRequest={isServerMode() ? () => void requestTitle() : undefined}
          requestState={requestState}
          tasteSignal={tasteSignal}
          onTasteSignal={
            settings.ratingScale === "thumbs" ? recordTasteSignal : undefined
          }
          playDisabledReason={
            !streams.hasDebrid
              ? "Add a debrid service in Settings to play"
              : null
          }
          onDownload={
            isTauri() && !isServerMode()
              ? () => {
                  setDownloadNotice(null);
                  setDownloadMenuOpen((open) => !open);
                }
              : undefined
          }
          downloadDisabledReason={downloadDisabledReason}
          onPlay={() => {
            // Instant play: if the auto-resolve job pre-cached a ready stream
            // for this title, play it immediately instead of re-walking the
            // indexers + debrid.
            if (cached != null) {
              void playStream(cached.stream);
              return;
            }
            // Series open the dedicated streams page; movies scroll the inline
            // picker into view.
            if (isSeries) {
              setStreamsPageOpen(true);
              return;
            }
            setScrollToStreams(true);
            queueMicrotask(() => {
              document
                .getElementById("detail-streams")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              setScrollToStreams(false);
            });
          }}
        />
      )}

      {downloadMenuOpen && (
        <section className="detail-download-menu glass-raised" aria-label="Download options">
          <div className="detail-download-menu-head">
            <div>
              <strong>{isSeries ? "Download episodes" : "Download movie"}</strong>
              <p className="t-secondary">
                {isSeries
                  ? "Queue the selected episode, season, or show. Each episode resolves its own source."
                  : "The best currently listed source is added to your desktop queue."}
              </p>
            </div>
            <button type="button" className="dl-icon-btn" onClick={() => setDownloadMenuOpen(false)} aria-label="Close download options">
              <Icon name="xmark" size={15} />
            </button>
          </div>
          <div className="detail-download-modes" role="group" aria-label="Download format">
            <button
              type="button"
              className={`chip${downloadMode === "full" ? " is-active dl-chip-active" : ""}`}
              onClick={() => setDownloadMode("full")}
            >
              Full size
            </button>
            <button
              type="button"
              className={`chip${downloadMode === "optimized" ? " is-active dl-chip-active" : ""}`}
              onClick={() => setDownloadMode("optimized")}
              disabled={ffmpegAvailable !== true}
              title={ffmpegAvailable === false ? "FFmpeg is unavailable on this desktop." : "Checking FFmpeg…"}
            >
              Optimized · remux
            </button>
          </div>
          {downloadMode === "optimized" && (
            <p className="detail-download-track-note t-secondary">
              Track languages are not available in stream results, so this remux keeps all audio and subtitle tracks.
            </p>
          )}
          {ffmpegAvailable === false && (
            <p className="detail-download-track-note t-secondary">
              Optimized downloads need FFmpeg. Choose Full size or install the desktop build with FFmpeg.
            </p>
          )}
          <div className="detail-download-actions">
            <button
              type="button"
              className="btn btn-prominent"
              onClick={() => void enqueueCurrentDownload()}
              disabled={filterStreamRows(streams.rows, settings).length === 0}
            >
              <Icon name="debrid" size={15} />
              {isSeries && selected != null
                ? `This episode (${episodeLabel(selected.season, selected.episode)})`
                : "Download movie"}
            </button>
            {isSeries && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={enqueueCurrentSeason}
                  disabled={selected == null || selectedSeasonEpisodes.loading || selectedSeasonEpisodes.episodes.length === 0}
                >
                  Season {selected?.season ?? ""}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={enqueueWholeShow}
                  disabled={seasonsState.loading || seasonsState.seasons.length === 0}
                >
                  Whole show
                </button>
              </>
            )}
          </div>
          {downloadNotice != null && <p className="detail-download-notice" role="status">{downloadNotice}</p>}
        </section>
      )}

      {/* Finished-watching marker (movies) - an honest state near the title.
          Series surface watched/in-progress per episode in the picker. */}
      {detailItem.type === "movie" && watchedState === "watched" && (
        <span className="detail-watched">
          <Icon name="check" size={13} />
          Watched
        </span>
      )}

      {/* No-metadata-key hint: the hero renders from the catalog preview alone
          (no overview/genres) - say why, and where to fix it, instead of just
          looking sparse. Local Mode only; Server Mode proxies the server key. */}
      {item && detail.source === "fixtures" && !detail.loading && !isServerMode() && (
        <p className="detail-nokey-hint t-secondary">
          Showing basic info - add a free TMDB key for the full details:
          overview, genres, and the episode guide.
          <button
            type="button"
            className="detail-nokey-link"
            onClick={() => {
              closeDetail();
              navigate("settings");
            }}
          >
            Add a key in Settings
          </button>
        </p>
      )}

      {/* Watch the official trailer in-app (YouTube, privacy-nocookie embed).
          Hidden until TMDB confirms a trailer exists for this title. */}
      {trailer.key != null && (
        <button
          type="button"
          className="btn detail-trailer-btn"
          onClick={() => setTrailerOpen(true)}
        >
          <Icon name="play" size={14} />
          Watch trailer
        </button>
      )}

      {/* External ratings (IMDb / Rotten Tomatoes / Metacritic) via OMDb - 
          from the user's own key (local BYOK) or the server "hidden key" proxy.
          Renders nothing when no key is available. */}
      <OmdbRatings imdbId={detail.data.imdbId} />

      {/* Your own rating (1–10 pips or a 0–100 slider), collapsed behind an
          explicit "Rate" button so the stars don't sit out permanently. Thumbs
          mode keeps the like/dislike control in the hero instead. The key resets
          the reveal to collapsed when the title changes. */}
      {settings.ratingScale !== "thumbs" && (
        <RatingReveal
          key={detailItem.id}
          scale={settings.ratingScale}
          value={
            ratingNorm != null
              ? Math.round(ratingNorm * (settings.ratingScale === "hundred" ? 100 : 10))
              : null
          }
          onRate={recordRating}
          onClear={clearRating}
        />
      )}

      {/* AI "Will I like this?" - always present, honestly gated. With a local AI
          provider it renders the verdict card; without one it shows a quiet hint
          and a link into Settings rather than silently vanishing. Server-Mode
          analyzeTitle parity is out of scope (local-Dexie path only). */}
      {item &&
        (services.ai?.analyzeTitle != null ? (
          <DetailAnalysis item={item} provider={services.ai} />
        ) : (
          <p className="detail-ai-hint t-secondary">
            <Icon name="sparkles" size={14} className="t-accent" />
            Add an AI provider in Settings to get a personal verdict on whether
            you'd like this.
            <button
              type="button"
              className="detail-ai-hint-link"
              onClick={() => {
                closeDetail();
                navigate("settings");
              }}
            >
              Open Settings
            </button>
          </p>
        ))}

      {/* Season/episode picker (series only). Selecting an episode re-drives
          the stream search below; falls back to a plain stepper without TMDB. */}
      {detailItem.type === "series" && selected != null && (
        <EpisodePicker
          tmdbId={item?.tmdbId ?? detailItem.tmdbId ?? null}
          tmdb={services.tmdb}
          selected={selected}
          onSelect={(next) => {
            // Picking an episode opens the dedicated streams page for it.
            selectEpisode(detailItem.id, next);
            setStreamsPageOpen(true);
          }}
          progressByEpisodeId={progressByEpisodeId}
          watchedEpisodeIds={watchedEpisodeIds}
          onToggleWatched={(ep, watched) => {
            // Watched → a completed 1/1 record (no resume bar); unwatched → a
            // zeroed incomplete record. Both flow through recordResume so the
            // history + continue-watching state refresh automatically.
            const epId = episodeIdFor(ep.season, ep.episode);
            if (watched) {
              recordResume(detailItem, 1, 1, epId);
            } else {
              recordResume(detailItem, 0, null, epId);
            }
          }}
        />
      )}

      {/* Movies: the stream list sits inline. Series show it on a dedicated
          page (below) opened by picking an episode. */}
      {!isSeries && (
        <div
          id="detail-streams"
          ref={streamsAnchorRef}
          className={scrollToStreams ? "detail-streams-anchor" : undefined}
        >
          <StreamPicker
            state={streams}
            resolveStream={resolveSelectedStream}
            onPlay={handlePlay}
            episodeLabel={null}
            episodeContext={null}
            onOpenSettings={() => {
              closeDetail();
              navigate("settings");
            }}
          />
        </div>
      )}

      <CastRail cast={detail.data.cast} />

      <Rail
        title="More like this"
        items={detail.data.related}
        onSelect={openDetail}
      />
      </div>

      {/* Series streams live on their own page (opened by picking an episode),
          instead of loading inline at the bottom of Detail. */}
      {isSeries && streamsPageOpen && selected != null && (
        <div
          className="episode-streams"
          role="dialog"
          aria-modal="true"
          aria-label={`Streams - ${episodeLabel(selected.season, selected.episode)}`}
        >
          <div className="episode-streams-panel">
            <div className="episode-streams-head">
              <button
                ref={streamsBackRef}
                type="button"
                className="episode-streams-back"
                onClick={() => setStreamsPageOpen(false)}
              >
                ‹ Episodes
              </button>
              <strong className="episode-streams-title">
                {(item?.title ?? detailItem.title) + " · "}
                {episodeLabel(selected.season, selected.episode)}
              </strong>
            </div>
            <div className="episode-streams-body">
              <StreamPicker
                state={streams}
                resolveStream={resolveSelectedStream}
                onPlay={handlePlay}
                episodeLabel={episodeLabel(selected.season, selected.episode)}
                episodeContext={selected}
                onOpenSettings={() => {
                  closeDetail();
                  navigate("settings");
                }}
              />
            </div>
          </div>
        </div>
      )}

      {player && (
        <Suspense fallback={<Spinner variant="overlay" label="Loading player…" />}>
          <VideoPlayer
            url={player.url}
            title={player.title}
            subtitle={player.subtitle}
            sourceFileName={player.sourceFileName}
            engine={player.engine}
            requestWebviewFallback={
              player.fallbackStream != null && services.debrid != null
                ? () => services.debrid!.getTranscodeHLS(player.fallbackStream!)
                : undefined
            }
            preferredPlayer={settings.preferredExternalPlayer}
            useBuiltInPlayer={settings.builtInPlayer}
            startPositionSeconds={player.startPositionSeconds}
            savedPrefs={player.savedPrefs}
            onClose={closePlayer}
            onProgress={(current, duration, prefs) => {
              // Persist a resume position against the title (movies) or the
              // SNAPSHOTTED episode (series) so Continue Watching resumes the
              // right thing even if the picker changed mid-playback. `prefs`
              // carries the in-window player's audio/sub/speed for next time.
              recordResume(detailItem, current, duration, player.episodeId, prefs);
            }}
            // Subtitle search/translate context. The client/config are null when
            // the OpenSubtitles key / AI provider aren't configured, so the
            // player gates those affordances gracefully.
            subtitleClient={services.subtitles}
            translator={services.translator}
            imdbId={detail.data.imdbId}
            season={player.season}
            episode={player.episode}
            upNext={
              upNextTarget != null
                ? { label: episodeLabel(upNextTarget.season, upNextTarget.episode) }
                : null
            }
            onPlayNext={handlePlayNext}
            autoCountdown={Boolean(settings.autoAdvanceEpisodes) && !settings.dataSaver}
          />
        </Suspense>
      )}

      {trailerOpen && trailer.key != null && (
        <TrailerModal
          videoKey={trailer.key}
          title={detailItem.title}
          onClose={() => setTrailerOpen(false)}
        />
      )}
    </div>
  );
}
