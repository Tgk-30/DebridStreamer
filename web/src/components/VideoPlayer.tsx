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
import type { SubtitleClient } from "../services/subtitles/OpenSubtitlesClient";
import type { Translator } from "../services/subtitles/SubtitleTranslator";
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
  /** Resume position (seconds) from the saved watch history. The in-webview
   * player seeks here once, on first metadata load — making cross-device resume
   * actually pick up where you left off. 0/undefined starts from the beginning. */
  startPositionSeconds?: number;
  /** Subtitle source (local OpenSubtitles client or the Server-Mode client) when
   * available — powers subtitle search. Null disables the search UI. */
  subtitleClient?: SubtitleClient | null;
  /** Subtitle translator (local or Server-Mode) when available — powers subtitle
   * translation. Null hides the translate action. */
  translator?: Translator | null;
  /** Auto-seed context for the captions search. */
  imdbId?: string | null;
  season?: number | null;
  episode?: number | null;
}

/** Toggle fullscreen on an element, defensively (the APIs are absent in jsdom
 * and on some webviews — the optional calls then no-op rather than throw). */
function toggleFullscreen(el: HTMLElement): void {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  const active = document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  if (active != null) {
    void document.exitFullscreen?.();
  } else {
    void el.requestFullscreen?.();
  }
}

/** True when a keystroke should be left to the focused control: a text field, or
 * the <video> itself whose native controls already handle the key. */
function shouldIgnoreShortcut(
  target: EventTarget | null,
  video: HTMLVideoElement,
): boolean {
  if (target === video) return true;
  const el = target as HTMLElement | null;
  if (el == null) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
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
  startPositionSeconds,
  subtitleClient,
  translator,
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
            startPositionSeconds={startPositionSeconds}
            onHlsUnsupported={() =>
              setExternalError("This browser can't play HLS. Try the desktop app.")
            }
            subtitleClient={subtitleClient ?? null}
            translator={translator ?? null}
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
  startPositionSeconds,
  onHlsUnsupported,
  subtitleClient,
  translator,
  imdbId,
  season,
  episode,
}: {
  url: string;
  title: string;
  onProgress?: (currentSeconds: number, durationSeconds: number | null) => void;
  startPositionSeconds?: number;
  onHlsUnsupported: () => void;
  subtitleClient: SubtitleClient | null;
  translator: Translator | null;
  imdbId: string | null;
  season: number | null;
  episode: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const subs = useSubtitleTracks(subtitleClient, translator);
  // Thumbnails only work on a progressive source the browser can re-open and
  // seek (MP4/WebM). For HLS the manifest URL can't drive a second <video>
  // reliably, so gate them to non-HLS in-webview sources.
  const isHls = url.split("?")[0].toLowerCase().endsWith(".m3u8");
  const thumbs = useScrubThumbnails(url, !isHls);

  // Report playback progress (throttled to ~once / 5s) + keep currentTime/
  // duration in sync for the custom scrub bar.
  const lastReportRef = useRef(0);
  // Keep the latest onProgress in a ref so the effect doesn't re-subscribe each
  // render (onProgress identity changes every render → re-subscribe loop).
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  // Stable ref for the HLS-unsupported callback so the source-attach effect does
  // NOT list a fresh inline arrow in its deps. Detail re-renders every ~5s (the
  // progress → recordResume → refreshHistory loop), and a changing callback
  // identity would otherwise re-run that effect and reload video.src — restarting
  // playback from 0 every few seconds.
  const onHlsUnsupportedRef = useRef(onHlsUnsupported);
  onHlsUnsupportedRef.current = onHlsUnsupported;
  // Resume position is captured in a ref + a one-shot guard so we seek exactly
  // once, when metadata first loads, without re-subscribing the effect.
  const startPositionRef = useRef(startPositionSeconds);
  startPositionRef.current = startPositionSeconds;
  const didSeekRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;
    didSeekRef.current = false;

    const report = () => {
      const d = Number.isFinite(video.duration) ? video.duration : null;
      onProgressRef.current?.(video.currentTime, d);
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      const now = Date.now();
      if (onProgressRef.current != null && now - lastReportRef.current >= 5000) {
        lastReportRef.current = now;
        report();
      }
    };
    // Cross-device resume: seek to the saved position once, but only if it's a
    // meaningful offset and not basically at the end (so a finished item still
    // starts fresh). HLS reports `duration` AFTER loadedmetadata, so when the
    // duration isn't known yet we wait and let the durationchange handler retry
    // — seeking into an unknown/zero seekable range just gets clamped to 0 and,
    // since we'd have marked it done, would never resume.
    const applyResume = () => {
      if (didSeekRef.current) return;
      const start = startPositionRef.current ?? 0;
      if (start <= 5) {
        didSeekRef.current = true; // nothing meaningful to resume to
        return;
      }
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      if (d <= 0) return; // duration unknown yet (HLS) — retry on durationchange
      if (start >= d - 10) {
        didSeekRef.current = true; // basically finished — don't resume
        return;
      }
      didSeekRef.current = true;
      try {
        video.currentTime = start;
      } catch {
        // Some sources reject an early seek; the timeupdate path will catch up.
      }
    };
    const onLoadedMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      applyResume();
    };
    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      applyResume();
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("durationchange", onDurationChange);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("durationchange", onDurationChange);
      if (onProgressRef.current != null && video.currentTime > 0) report();
    };
  }, [url]);

  // Wire hls.js for HLS streams when the browser can't play them natively.
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;

    if (!isHls) {
      // Only (re)assign on an actual URL change — reassigning the same src
      // invokes the media load algorithm and restarts playback from 0.
      if (video.src !== url) video.src = url;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      if (video.src !== url) video.src = url;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    onHlsUnsupportedRef.current();
  }, [url, isHls]);

  // Reflect the active subtitle track onto the <video>'s text tracks: show only
  // the active one, hide the rest. Match by label (our <track> elements carry
  // label={t.label}) rather than by index, because hls.js can inject its own
  // in-band subtitle tracks that desync a positional pairing. Tracks that don't
  // correspond to one of ours (e.g. hls.js-injected) are left untouched.
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;
    const list = video.textTracks;
    for (let i = 0; i < list.length; i += 1) {
      const tt = list[i];
      if (tt.kind !== "subtitles") continue;
      const match = subs.tracks.find((t) => t.label === tt.label);
      if (match == null) continue; // not one of ours (hls.js-injected) — leave it
      tt.mode = match.id === subs.activeTrackId ? "showing" : "hidden";
    }
  }, [subs.tracks, subs.activeTrackId]);

  const seek = (t: number) => {
    const video = videoRef.current;
    if (video != null && Number.isFinite(t)) video.currentTime = t;
  };

  // Keyboard shortcuts (invisible power-user nicety). Active only while this
  // in-app player is mounted. Ignored when typing in a field (the CaptionsMenu
  // search, the ⌘K palette) or when a modifier is held (so ⌘K still toggles the
  // palette), and yields to the native <video> controls when the video itself is
  // focused. space/k: play-pause · ←/→: ∓5s · j/l: ∓10s · ↑/↓: volume · m: mute
  // · f: fullscreen · 0-9: seek to N0% · Home/End: start/end.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (video == null) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shouldIgnoreShortcut(e.target, video)) return;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTo = (t: number) => {
        video.currentTime = dur > 0 ? Math.min(Math.max(t, 0), dur) : Math.max(t, 0);
      };
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          if (video.paused) void video.play();
          else video.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekTo(video.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekTo(video.currentTime + 5);
          break;
        case "j":
        case "J":
          e.preventDefault();
          seekTo(video.currentTime - 10);
          break;
        case "l":
        case "L":
          e.preventDefault();
          seekTo(video.currentTime + 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = Math.min(1, Math.round((video.volume + 0.1) * 100) / 100);
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = Math.max(0, Math.round((video.volume - 0.1) * 100) / 100);
          break;
        case "m":
        case "M":
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case "f":
        case "F": {
          e.preventDefault();
          const stage = video.closest(".player-stage");
          toggleFullscreen(stage instanceof HTMLElement ? stage : video);
          break;
        }
        case "Home":
          e.preventDefault();
          seekTo(0);
          break;
        case "End":
          e.preventDefault();
          if (dur > 0) seekTo(dur);
          break;
        case "?":
          e.preventDefault();
          setShortcutsOpen((o) => !o);
          break;
        default:
          if (/^[0-9]$/.test(e.key) && dur > 0) {
            e.preventDefault();
            seekTo((Number(e.key) / 10) * dur);
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="webview-player">
      <div className="player-stage">
        <video
          ref={videoRef}
          className="player-video"
          controls
          autoPlay
          playsInline
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
            aria-haspopup="dialog"
            aria-expanded={captionsOpen}
            title="Subtitles"
          >
            <Icon name="captions" size={14} />
            CC
            {subs.activeTrackId != null && (
              <span className="captions-active-dot" />
            )}
          </button>
          <button
            type="button"
            className={`chip player-help-btn${shortcutsOpen ? " is-active" : ""}`}
            onClick={() => setShortcutsOpen((o) => !o)}
            aria-label="Keyboard shortcuts"
            aria-haspopup="dialog"
            aria-expanded={shortcutsOpen}
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </div>
      </div>

      {shortcutsOpen && (
        <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />
      )}

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

/** A small, dismissible reference for the player keyboard shortcuts. Surfaced
 * by the "?" key or the "?" OSD button — invisible otherwise. */
const SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "Play / pause"],
  ["← / →", "Back / forward 5s"],
  ["J / L", "Back / forward 10s"],
  ["↑ / ↓", "Volume up / down"],
  ["M", "Mute"],
  ["F", "Fullscreen"],
  ["0 – 9", "Jump to 0–90%"],
  ["Home / End", "Start / end"],
  ["?", "Toggle this help"],
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="player-shortcuts-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="player-shortcuts glass-raised"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="player-shortcuts-head">
          <span className="player-shortcuts-title">Keyboard shortcuts</span>
          <button
            type="button"
            className="player-shortcuts-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="xmark" size={16} />
          </button>
        </div>
        <ul className="player-shortcuts-list">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={keys}>
              <kbd>{keys}</kbd>
              <span>{label}</span>
            </li>
          ))}
        </ul>
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
