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

import { lazy, Suspense, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useDetail } from "../data/detail";
import { useStreams } from "../data/streams";
import { DetailHero } from "../components/DetailHero";
import { StreamPicker } from "../components/StreamPicker";
import { CastRail } from "../components/CastRail";
import { Rail } from "../components/Rail";
import { Spinner } from "../components/Spinner";
import { isInWatchlist } from "../data/library";
import { VideoCodec, type StreamInfo } from "../services/debrid/models";
import type { TorrentResult } from "../services/indexers/models";
import type { StreamRow } from "../data/streams";
import { resolveServerStream } from "../lib/serverApi";
import { isServerMode } from "../lib/serverMode";
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
    watchlist,
    toggleWatchlist,
    recordResume,
    continueWatching,
    cachedResolutions,
  } = useAppStore();

  const detail = useDetail(detailItem, services.tmdb);
  const streams = useStreams(
    detail.data.imdbId,
    detailItem?.type ?? "movie",
    services.indexers,
    services.debrid,
  );

  const [player, setPlayer] = useState<ActivePlayer | null>(null);
  const [scrollToStreams, setScrollToStreams] = useState(false);

  if (detailItem == null) return null;

  const item = detail.data.item;
  const inWatchlist = isInWatchlist(watchlist, detailItem.id);
  // A pre-resolved, ready-to-play stream from the watchlist auto-resolve job.
  const cached = cachedResolutions[detailItem.id] ?? null;

  /** Resume position (seconds) for this title, read from the already-loaded
   * Continue Watching list (cross-device synced in Server Mode) — 0 when there's
   * no in-progress record or it's completed. */
  function resumeSecondsFor(): number {
    if (detailItem == null) return 0;
    const record = continueWatching.find(
      (h) => h.mediaId === detailItem.id && h.episodeId == null,
    );
    return record != null && !record.completed ? record.progressSeconds : 0;
  }

  /** Open the player, seeking to any saved resume position. */
  function openPlayer(url: string, title: string, external: boolean): void {
    setPlayer({ url, title, external, startPositionSeconds: resumeSecondsFor() });
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
      return resolveServerStream(row);
    }
    if (services.debrid == null || !services.debrid.hasServices) {
      throw new Error("Configure a debrid service to play.");
    }
    return services.debrid.resolveStream(row.result.infoHash, row.cachedOn);
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
    <div className="detail">
      <div className="detail-inner">
      {item && (
        <DetailHero
          item={item}
          inWatchlist={inWatchlist}
          onClose={closeDetail}
          onToggleWatchlist={() => toggleWatchlist(detailItem)}
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

      <div
        id="detail-streams"
        className={scrollToStreams ? "detail-streams-anchor" : undefined}
      >
        <StreamPicker
          state={streams}
          resolveStream={resolveSelectedStream}
          onPlay={handlePlay}
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
              // Persist a resume position against the title being viewed so the
              // History "Continue Watching" rail can pick it back up.
              recordResume(detailItem, current, duration);
            }}
            // Subtitle search/translate context. The client/config are null when
            // the OpenSubtitles key / AI provider aren't configured, so the
            // player gates those affordances gracefully.
            subtitleClient={services.subtitles}
            translator={services.translator}
            imdbId={detail.data.imdbId}
          />
        </Suspense>
      )}
    </div>
  );
}
