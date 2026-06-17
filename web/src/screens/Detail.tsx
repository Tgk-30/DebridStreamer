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

import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { useDetail } from "../data/detail";
import { useStreams } from "../data/streams";
import { DetailHero } from "../components/DetailHero";
import { StreamPicker } from "../components/StreamPicker";
import { CastRail } from "../components/CastRail";
import { Rail } from "../components/Rail";
import { VideoPlayer } from "../components/VideoPlayer";
import { isInWatchlist } from "../data/library";
import { VideoCodec, type StreamInfo } from "../services/debrid/models";
import type { TorrentResult } from "../services/indexers/models";
import "./Detail.css";

interface ActivePlayer {
  url: string;
  title: string;
  /** Force the external path for MKV/HEVC. */
  external: boolean;
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
    services,
    watchlist,
    toggleWatchlist,
    recordResume,
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

  async function handlePlay(stream: StreamInfo, source: TorrentResult) {
    const title = stream.fileName || source.title;

    // Browser-playable (MP4/WebM/H.264) — play the direct link in-webview.
    if (!needsTranscodeOrExternal(stream, source)) {
      setPlayer({ url: stream.streamURL, title, external: false });
      return;
    }

    // MKV / HEVC / AV1: prefer Real-Debrid transcode-to-HLS so it plays IN the
    // window (hls.js). Only RD resolves this (gated inside DebridManager via the
    // stream's `restrictedId`); any failure / non-RD source returns null and we
    // fall back to the native-player hand-off below.
    const hlsUrl = await services.debrid?.getTranscodeHLS(stream).catch(() => null);
    if (hlsUrl != null) {
      // In-window: the .m3u8 routes through the webview hls.js path.
      setPlayer({ url: hlsUrl, title, external: false });
      return;
    }

    // Fallback: native player (mpv/VLC) via the desktop hand-off.
    setPlayer({ url: stream.streamURL, title, external: true });
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
          debrid={services.debrid}
          onPlay={handlePlay}
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
        <VideoPlayer
          url={player.url}
          title={player.title}
          kind={player.external ? "external" : undefined}
          onClose={() => setPlayer(null)}
          onProgress={(current, duration) => {
            // Persist a resume position against the title being viewed so the
            // History "Continue Watching" rail can pick it back up.
            recordResume(detailItem, current, duration);
          }}
        />
      )}
    </div>
  );
}
