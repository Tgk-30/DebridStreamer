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
import { isTauri, openInExternalPlayer } from "../lib/tauri";
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
}: VideoPlayerProps) {
  const mode = kind ?? classify(url);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [externalStatus, setExternalStatus] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  // Report playback progress (throttled to ~once / 5s) so the store can persist
  // a resume position, and flush a final report when the player unmounts.
  const lastReportRef = useRef(0);
  useEffect(() => {
    if (mode !== "webview" || onProgress == null) return;
    const video = videoRef.current;
    if (video == null) return;

    const report = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      onProgress(video.currentTime, duration);
    };
    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastReportRef.current >= 5000) {
        lastReportRef.current = now;
        report();
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      // Final flush on close so the resume point is current.
      if (video.currentTime > 0) report();
    };
  }, [mode, onProgress, url]);

  // Wire hls.js for HLS streams when the browser can't play them natively.
  useEffect(() => {
    if (mode !== "webview") return;
    const video = videoRef.current;
    if (video == null) return;

    const isHls = url.split("?")[0].toLowerCase().endsWith(".m3u8");
    if (!isHls) {
      video.src = url;
      return;
    }

    // Safari plays HLS natively; elsewhere use hls.js.
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
    // No HLS support anywhere — let the user know.
    setExternalError("This browser can't play HLS. Try the desktop app.");
  }, [mode, url]);

  // Auto-hand-off to a native player when running under Tauri.
  const underTauri = isTauri();
  useEffect(() => {
    if (mode !== "external" || !underTauri) return;
    let cancelled = false;
    openInExternalPlayer(url)
      .then((status) => {
        if (!cancelled) setExternalStatus(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setExternalError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
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
          <video
            ref={videoRef}
            className="player-video"
            controls
            autoPlay
            playsInline
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
          <h3 className="player-external-title">Opening in your native player</h3>
          <p className="player-external-sub t-secondary">
            {status ??
              "This file (MKV/HEVC) plays best in VLC or mpv. Handing it off…"}
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
