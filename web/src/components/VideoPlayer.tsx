// In-app player.
//
// Two-backend playback (the plan proven by poc-tauri):
//   1. In-webview <video> for HLS (.m3u8, via hls.js when the browser lacks
//      native HLS) and progressive MP4/WebM — the browser path.
//   2. Desktop hand-off to a native player (VLC/mpv/IINA) for containers/codecs
//      the webview can't decode (MKV / HEVC) — only when running under Tauri,
//      via the `open_in_external_player` Rust command. In a plain browser this
//      path shows an "open externally" note instead.
//
// `kind` lets the caller force the external path (e.g. an MKV stream); otherwise
// the extension is sniffed from the URL.

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Icon } from "./Icon";
import {
  isTauri,
  openInExternalPlayer,
  playWithMpv,
  mpvStop,
} from "../lib/tauri";
import type { OpenSubtitlesClient } from "../services/subtitles/OpenSubtitlesClient";
import type { TranslatorConfig } from "../services/subtitles/SubtitleTranslator";
import { useSubtitleTracks } from "./player/useSubtitleTracks";
import { useScrubThumbnails } from "./player/useScrubThumbnails";
import { ScrubBar } from "./player/ScrubBar";
import { CaptionsMenu } from "./player/CaptionsMenu";
import "./VideoPlayer.css";

type Playability = "webview" | "external";

interface VideoPlayerProps {
  url: string;
  title: string;
  /** Force a path; when omitted it's sniffed from the URL extension. */
  kind?: Playability;
  onClose: () => void;
  /** Reports playback progress (seconds watched + total duration) so the store
   * can persist a resume position. Called periodically and on close. */
  onProgress?: (currentSeconds: number, durationSeconds: number | null) => void;
  /** OpenSubtitles client (when a key is configured) — powers subtitle search.
   * Null disables the search UI (a "configure key" state is shown). */
  subtitleClient?: OpenSubtitlesClient | null;
  /** AI provider config (when configured) — powers subtitle translation. Null
   * hides the translate action. */
  translatorConfig?: TranslatorConfig | null;
  /** Auto-seed context for the captions search. */
  imdbId?: string | null;
  season?: number | null;
  episode?: number | null;
}

/** Decide whether the webview can plausibly play this URL or whether it needs a
 * native player. MKV / HEVC / AVI etc. are handed off; HLS / MP4 / WebM play
 * in-webview. */
function classify(url: string): Playability {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".m3u8") || lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".webm") || lower.endsWith(".mov")) {
    return "webview";
  }
  if (lower.endsWith(".mkv") || lower.endsWith(".avi") || lower.endsWith(".ts") || lower.endsWith(".wmv") || lower.endsWith(".flv")) {
    return "external";
  }
  // Unknown extension (e.g. a debrid direct link without one): attempt webview.
  return "webview";
}

export function VideoPlayer({
  url,
  title,
  kind,
  onClose,
  onProgress,
  subtitleClient,
  translatorConfig,
  imdbId,
  season,
  episode,
}: VideoPlayerProps) {
  const mode = kind ?? classify(url);
  const [externalStatus, setExternalStatus] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  // Native hand-off when running under Tauri. Primary path is the BUNDLED mpv
  // sidecar (shipped + app-controlled over IPC); if mpv isn't available we fall
  // back to the raw VLC/IINA hand-off. On macOS mpv's `--wid` in-window
  // embedding is unreliable, so mpv typically opens its own (app-controlled)
  // window — see src-tauri/src/player.rs. mpv is stopped when this panel closes.
  const underTauri = isTauri();
  const startedMpvRef = useRef(false);
  useEffect(() => {
    if (mode !== "external" || !underTauri) return;
    let cancelled = false;
    startedMpvRef.current = false;

    playWithMpv(url)
      .then((res) => {
        if (cancelled) return;
        startedMpvRef.current = true;
        setExternalStatus(
          res.embedded
            ? "Playing in the bundled mpv (in-window embedding attempted)."
            : "Playing in the bundled mpv player.",
        );
      })
      .catch(() => {
        // mpv missing / failed to spawn — fall back to the VLC/IINA hand-off.
        if (cancelled) return;
        openInExternalPlayer(url)
          .then((status) => {
            if (!cancelled) setExternalStatus(status);
          })
          .catch((err) => {
            if (!cancelled) {
              setExternalError(err instanceof Error ? err.message : String(err));
            }
          });
      });

    return () => {
      cancelled = true;
      // Tear down the bundled mpv if we started it (no-op for the VLC fallback).
      if (startedMpvRef.current) {
        mpvStop().catch(() => {});
      }
    };
  }, [mode, underTauri, url]);

  return (
    <div className="player-backdrop" onClick={onClose}>
      <div
        className="player glass-hero glass-lit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-bar">
          <span className="player-title">{title}</span>
          <button
            type="button"
            className="player-close"
            onClick={onClose}
            aria-label="Close player"
          >
            <Icon name="xmark" size={18} />
          </button>
        </div>

        {mode === "webview" && externalError == null ? (
          <WebviewPlayer
            url={url}
            title={title}
            onProgress={onProgress}
            onHlsUnsupported={() =>
              setExternalError("This browser can't play HLS. Try the desktop app.")
            }
            subtitleClient={subtitleClient ?? null}
            translatorConfig={translatorConfig ?? null}
            imdbId={imdbId ?? null}
            season={season ?? null}
            episode={episode ?? null}
          />
        ) : (
          <ExternalPanel
            underTauri={underTauri}
            url={url}
            status={externalStatus}
            error={externalError}
          />
        )}
      </div>
    </div>
  );
}

/** The in-webview `<video>` path with the custom scrub-thumbnail bar + captions
 * OSD. Split out so the subtitle/thumbnail hooks mount only on this path (never
 * for the external mpv/VLC hand-off, where there's no frame source). */
function WebviewPlayer({
  url,
  title,
  onProgress,
  onHlsUnsupported,
  subtitleClient,
  translatorConfig,
  imdbId,
  season,
  episode,
}: {
  url: string;
  title: string;
  onProgress?: (currentSeconds: number, durationSeconds: number | null) => void;
  onHlsUnsupported: () => void;
  subtitleClient: OpenSubtitlesClient | null;
  translatorConfig: TranslatorConfig | null;
  imdbId: string | null;
  season: number | null;
  episode: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captionsOpen, setCaptionsOpen] = useState(false);

  const subs = useSubtitleTracks(subtitleClient, translatorConfig);
  // Thumbnails only work on a progressive source the browser can re-open and
  // seek (MP4/WebM). For HLS the manifest URL can't drive a second <video>
  // reliably, so gate them to non-HLS in-webview sources.
  const isHls = url.split("?")[0].toLowerCase().endsWith(".m3u8");
  const thumbs = useScrubThumbnails(url, !isHls);

  // Report playback progress (throttled to ~once / 5s) + keep currentTime/
  // duration in sync for the custom scrub bar.
  const lastReportRef = useRef(0);
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;

    const report = () => {
      const d = Number.isFinite(video.duration) ? video.duration : null;
      onProgress?.(video.currentTime, d);
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      const now = Date.now();
      if (onProgress != null && now - lastReportRef.current >= 5000) {
        lastReportRef.current = now;
        report();
      }
    };
    const onLoadedMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("durationchange", onDurationChange);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("durationchange", onDurationChange);
      if (onProgress != null && video.currentTime > 0) report();
    };
  }, [onProgress, url]);

  // Wire hls.js for HLS streams when the browser can't play them natively.
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;

    if (!isHls) {
      video.src = url;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    onHlsUnsupported();
  }, [url, isHls, onHlsUnsupported]);

  // Reflect the active subtitle track onto the <video>'s text tracks: show only
  // the active one, hide the rest. Runs whenever tracks / the active id change.
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;
    const list = video.textTracks;
    for (let i = 0; i < list.length; i += 1) {
      const tt = list[i];
      const match = subs.tracks[i];
      tt.mode =
        match != null && match.id === subs.activeTrackId ? "showing" : "hidden";
    }
  }, [subs.tracks, subs.activeTrackId]);

  const seek = (t: number) => {
    const video = videoRef.current;
    if (video != null && Number.isFinite(t)) video.currentTime = t;
  };

  return (
    <div className="webview-player">
      <div className="player-stage">
        <video
          ref={videoRef}
          className="player-video"
          controls
          autoPlay
          playsInline
          crossOrigin="anonymous"
        >
          {subs.tracks.map((t) => (
            <track
              key={t.id}
              kind="subtitles"
              src={t.vttUrl}
              srcLang={t.language}
              label={t.label}
              default={t.id === subs.activeTrackId}
            />
          ))}
        </video>
      </div>

      <div className="player-osd">
        <ScrubBar
          currentTime={currentTime}
          duration={duration}
          preview={thumbs.available ? thumbs.preview : null}
          onHover={thumbs.onHover}
          onLeave={thumbs.onLeave}
          onSeek={seek}
        />
        <div className="player-osd-row">
          <button
            type="button"
            className={`chip${captionsOpen || subs.activeTrackId != null ? " is-active" : ""}`}
            onClick={() => setCaptionsOpen((o) => !o)}
            aria-label="Subtitles"
            title="Subtitles"
          >
            <Icon name="captions" size={14} />
            CC
            {subs.activeTrackId != null && (
              <span className="captions-active-dot" />
            )}
          </button>
        </div>
      </div>

      {captionsOpen && (
        <CaptionsMenu
          subs={subs}
          seedTitle={title}
          seedImdbId={imdbId}
          seedSeason={season}
          seedEpisode={episode}
          onClose={() => setCaptionsOpen(false)}
        />
      )}
    </div>
  );
}

function ExternalPanel({
  underTauri,
  url,
  status,
  error,
}: {
  underTauri: boolean;
  url: string;
  status: string | null;
  error: string | null;
}) {
  return (
    <div className="player-external">
      <Icon name="play" size={36} className="t-accent" />
      {underTauri ? (
        <>
          <h3 className="player-external-title">Opening in the bundled player</h3>
          <p className="player-external-sub t-secondary">
            {status ??
              "This file (MKV/HEVC) plays in the bundled mpv player. Starting…"}
          </p>
          {error && <p className="player-external-err">{error}</p>}
        </>
      ) : (
        <>
          <h3 className="player-external-title">Open externally</h3>
          <p className="player-external-sub t-secondary">
            {error ??
              "This file (MKV/HEVC) needs a native player. In the desktop app it opens in VLC/mpv automatically; in the browser, copy the link into your player."}
          </p>
          <a
            className="btn"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open direct link
          </a>
        </>
      )}
    </div>
  );
}
