// Detail screen — the showcase, fully wired.
//
// Renders for the currently-selected MediaPreview (from the app store):
//   • DetailHero (backdrop + title/meta/overview + Play + Watchlist toggle)
//   • StreamPicker — the cached-on-debrid stream list (green Instant · RD vs grey
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
import { defaultSelectionFor, episodeIdFor, episodeLabel } from "../data/episodes";
import { EpisodePicker } from "../components/EpisodePicker";
import { DetailHero, type TasteSignal } from "../components/DetailHero";
import { DetailAnalysis } from "../components/DetailAnalysis";
import { OmdbRatings } from "../components/OmdbRatings";
import { StreamPicker } from "../components/StreamPicker";
import { CastRail } from "../components/CastRail";
import { Rail } from "../components/Rail";
import { Spinner } from "../components/Spinner";
import { isInWatchlist } from "../data/library";
import { VideoCodec, type StreamInfo } from "../services/debrid/models";
import type { TorrentResult } from "../services/indexers/models";
import type { StreamRow } from "../data/streams";
import { createRequest, resolveServerStream } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
import { useTranscodeAvailable } from "../lib/ServerSessionContext";
import { getStore } from "../storage";
import {
  hasResumePoint,
  watchProgressPercent,
  type TasteEventType,
} from "../storage/models";
import { rebuildTasteContext } from "../services/ai/TasteProfile";
import "./Detail.css";

// The VideoPlayer pulls in hls.js (large) and only mounts once the user starts
// playback, so it's code-split into its own chunk and kept out of the Detail
// chunk + the initial bundle.
const VideoPlayer = lazy(() =>
  import("../components/VideoPlayer").then((m) => ({ default: m.VideoPlayer })),
);

interface ActivePlayer {
  url: string;
  title: string;
  /** Force the external path for MKV/HEVC. */
  external: boolean;
  /** Saved resume position (seconds) to seek to on load; 0 starts fresh. */
  startPositionSeconds: number;
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
  source: TorrentResult,
): boolean {
  const name = stream.fileName.toLowerCase();
  const badContainer =
    name.endsWith(".mkv") ||
    name.endsWith(".avi") ||
    name.endsWith(".ts") ||
    name.endsWith(".wmv") ||
    name.endsWith(".flv");
  const badCodec =
    stream.codec === VideoCodec.h265 ||
    stream.codec === VideoCodec.av1 ||
    source.codec === VideoCodec.h265 ||
    source.codec === VideoCodec.av1;
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
    cachedResolutions,
  } = useAppStore();
  const transcodeAvailable = useTranscodeAvailable();

  const detail = useDetail(detailItem, services.tmdb);

  // Series episode selection: a user's explicit pick (session-only, per title)
  // wins; otherwise default to the most recently watched episode, else S1E1.
  // Movies stay null throughout — zero behavior change.
  const [episodeOverrides, setEpisodeOverrides] = useState<
    Record<string, { season: number; episode: number }>
  >({});
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
    services.indexers,
    services.debrid,
  );

  // Per-episode resume bars for the picker rows (this series only).
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

  const [player, setPlayer] = useState<ActivePlayer | null>(null);
  const [scrollToStreams, setScrollToStreams] = useState(false);

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

  const detailId = detailItem?.id ?? null;
  useEffect(() => {
    setRequestState("idle");
  }, [detailId]);

  useEffect(() => {
    if (detailId == null) {
      setTasteSignal(null);
      return;
    }
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
      })
      .catch(() => {
        if (!cancelled) setTasteSignal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  if (detailItem == null) return null;

  const item = detail.data.item;
  const inWatchlist = isInWatchlist(watchlist, detailItem.id);
  // A pre-resolved, ready-to-play stream from the watchlist auto-resolve job.
  // Movie-only: the cache is keyed per TITLE, so instant-playing it for a
  // series could play the wrong episode. Series always go through the picker.
  const cached =
    detailItem.type === "movie" ? cachedResolutions[detailItem.id] ?? null : null;

  /** Resume position (seconds) for the title (movies) or the SELECTED episode
   * (series), read from the already-loaded Continue Watching list
   * (cross-device synced in Server Mode) — 0 when there's no in-progress
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

  /** Open the player, seeking to any saved resume position. Snapshots the
   * episode context so a picker change mid-playback can't retarget progress. */
  function openPlayer(url: string, title: string, external: boolean): void {
    setPlayer({
      url,
      title,
      external,
      startPositionSeconds: resumeSecondsFor(),
      episodeId:
        selected != null ? episodeIdFor(selected.season, selected.episode) : null,
      season: selected?.season ?? null,
      episode: selected?.episode ?? null,
    });
  }

  /** Record (or toggle off) a like/dislike taste signal for the current title.
   * The event carries the title + genre names in metadata so the taste-profile
   * assembler can derive liked/disliked genres without a media-cache join. The
   * 24h taste-context cache is rebuilt so the next analysis reflects the change.
   *
   * Tapping the active thumb again toggles it off — recorded as a
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

  /** Play an already-resolved StreamInfo directly (the instant-play path for a
   * cached resolution). Mirrors handlePlay's container/codec routing but without
   * a TorrentResult to cross-check, so it keys off the stream alone. */
  async function playStream(stream: StreamInfo, title: string) {
    const name = stream.fileName.toLowerCase();
    const badContainer =
      name.endsWith(".mkv") ||
      name.endsWith(".avi") ||
      name.endsWith(".ts") ||
      name.endsWith(".wmv") ||
      name.endsWith(".flv");
    const badCodec =
      stream.codec === VideoCodec.h265 || stream.codec === VideoCodec.av1;
    if (!badContainer && !badCodec) {
      openPlayer(stream.streamURL, title, false);
      return;
    }
    const hlsUrl = await services.debrid?.getTranscodeHLS(stream).catch(() => null);
    if (hlsUrl != null) {
      openPlayer(hlsUrl, title, false);
      return;
    }
    openPlayer(stream.streamURL, title, true);
  }

  async function resolveSelectedStream(row: StreamRow): Promise<StreamInfo> {
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
    return services.debrid.resolveStream(row.result.infoHash, row.cachedOn);
  }

  /** File a Server-Mode title request for the current item. The detailItem is a
   *  MediaPreview — the same minimal shape watchlist add uses — so it's passed
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

  async function handlePlay(stream: StreamInfo, source: TorrentResult) {
    const title = stream.fileName || source.title;

    // Browser-playable (MP4/WebM/H.264) — play the direct link in-webview.
    if (!needsTranscodeOrExternal(stream, source)) {
      openPlayer(stream.streamURL, title, false);
      return;
    }

    // MKV / HEVC / AV1: prefer Real-Debrid transcode-to-HLS so it plays IN the
    // window (hls.js). Only RD resolves this (gated inside DebridManager via the
    // stream's `restrictedId`); any failure / non-RD source returns null and we
    // fall back to the native-player hand-off below.
    const hlsUrl = await services.debrid?.getTranscodeHLS(stream).catch(() => null);
    if (hlsUrl != null) {
      // In-window: the .m3u8 routes through the webview hls.js path.
      openPlayer(hlsUrl, title, false);
      return;
    }

    // Fallback: native player (mpv/VLC) via the desktop hand-off.
    openPlayer(stream.streamURL, title, true);
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
          onTasteSignal={recordTasteSignal}
          playDisabledReason={
            !streams.hasDebrid
              ? "Add a debrid service in Settings to play"
              : null
          }
          onPlay={() => {
            // Instant play: if the auto-resolve job pre-cached a ready stream
            // for this title, play it immediately instead of re-walking the
            // indexers + debrid.
            if (cached != null) {
              void playStream(cached.stream, cached.stream.fileName || detailItem.title);
              return;
            }
            setScrollToStreams(true);
            // Scroll the picker into view; the user picks a stream there.
            queueMicrotask(() => {
              document
                .getElementById("detail-streams")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              setScrollToStreams(false);
            });
          }}
        />
      )}

      {/* External ratings (IMDb / Rotten Tomatoes / Metacritic) via OMDb —
          from the user's own key (local BYOK) or the server "hidden key" proxy.
          Renders nothing when no key is available. */}
      <OmdbRatings imdbId={detail.data.imdbId} />

      {/* AI "Would I Like This?" — only when a local AI provider is configured.
          analyzeTitle is the local-Dexie path; Server-Mode parity is out of scope. */}
      {item && services.ai?.analyzeTitle != null && (
        <DetailAnalysis item={item} provider={services.ai} />
      )}

      {/* Season/episode picker (series only). Selecting an episode re-drives
          the stream search below; falls back to a plain stepper without TMDB. */}
      {detailItem.type === "series" && selected != null && (
        <EpisodePicker
          tmdbId={item?.tmdbId ?? detailItem.tmdbId ?? null}
          tmdb={services.tmdb}
          selected={selected}
          onSelect={(next) =>
            setEpisodeOverrides((m) => ({ ...m, [detailItem.id]: next }))
          }
          progressByEpisodeId={progressByEpisodeId}
        />
      )}

      <div
        id="detail-streams"
        className={scrollToStreams ? "detail-streams-anchor" : undefined}
      >
        <StreamPicker
          state={streams}
          resolveStream={resolveSelectedStream}
          onPlay={handlePlay}
          episodeLabel={
            selected != null ? episodeLabel(selected.season, selected.episode) : null
          }
          episodeContext={selected}
          onOpenSettings={() => {
            closeDetail();
            navigate("settings");
          }}
        />
      </div>

      <CastRail cast={detail.data.cast} />

      <Rail
        title="More like this"
        items={detail.data.related}
        onSelect={openDetail}
      />
      </div>

      {player && (
        <Suspense fallback={<Spinner variant="overlay" label="Loading player…" />}>
          <VideoPlayer
            url={player.url}
            title={player.title}
            kind={player.external ? "external" : undefined}
            startPositionSeconds={player.startPositionSeconds}
            onClose={() => setPlayer(null)}
            onProgress={(current, duration) => {
              // Persist a resume position against the title (movies) or the
              // SNAPSHOTTED episode (series) so Continue Watching resumes the
              // right thing even if the picker changed mid-playback.
              recordResume(detailItem, current, duration, player.episodeId);
            }}
            // Subtitle search/translate context. The client/config are null when
            // the OpenSubtitles key / AI provider aren't configured, so the
            // player gates those affordances gracefully.
            subtitleClient={services.subtitles}
            translator={services.translator}
            imdbId={detail.data.imdbId}
            season={player.season}
            episode={player.episode}
          />
        </Suspense>
      )}
    </div>
  );
}
