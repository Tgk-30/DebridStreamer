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

export function Detail() {
  const {
    detailItem,
    closeDetail,
    openDetail,
    services,
    watchlist,
    toggleWatchlist,
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

  function handlePlay(stream: StreamInfo, source: TorrentResult) {
    // MKV / HEVC can't decode in the webview — force the external path.
    const isMkv = stream.fileName.toLowerCase().endsWith(".mkv");
    const isHevc =
      stream.codec === VideoCodec.h265 || source.codec === VideoCodec.h265;
    setPlayer({
      url: stream.streamURL,
      title: stream.fileName || source.title,
      external: isMkv || isHevc,
    });
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
        />
      )}
    </div>
  );
}
