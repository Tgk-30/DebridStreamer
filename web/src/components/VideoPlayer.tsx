// In-app player.
//
// Two-backend playback (the plan proven by poc-tauri):
//   1. In-webview <video> for HLS (.m3u8, via hls.js when the browser lacks
//      native HLS) and progressive MP4/WebM - the browser path.
//   2. Desktop hand-off to a native player (VLC/mpv/IINA) for containers/codecs
//      the webview can't decode (MKV / HEVC) - only when running under Tauri,
//      via the `open_in_external_player` Rust command. In a plain browser this
//      path shows an "open externally" note instead.
//
// `kind` lets the caller force the external path (e.g. an MKV stream); otherwise
// the extension is sniffed from the URL.

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
// Type-only: the runtime module is imported on demand inside the HLS effect
// below, so this import contributes no bytes to the chunk.
import type HlsType from "hls.js";
type HlsInstance = InstanceType<typeof HlsType>;
import { Icon } from "./Icon";
import {
  isTauri,
  openInExternalPlayer,
  playWithMpv,
  mpvStop,
} from "../lib/tauri";
import { deviceKind } from "../lib/platform";
import type { SubtitleClient } from "../services/subtitles/OpenSubtitlesClient";
import type { Translator } from "../services/subtitles/SubtitleTranslator";
import { useSubtitleTracks } from "./player/useSubtitleTracks";
import { useScrubThumbnails } from "./player/useScrubThumbnails";
import { ScrubBar } from "./player/ScrubBar";
import { CaptionsMenu } from "./player/CaptionsMenu";
import { EmbeddedPlayer } from "./EmbeddedPlayer";
import type { PlaybackPrefs } from "../storage/models";
import {
  currentViewportPixelSize,
  type PixelSize,
  type PlaybackEngine,
} from "../lib/playbackEngine";
import { PlayerInfoPopover } from "./player/PlayerInfoPopover";
import {
  PlayerPauseOverlay,
  type NowPlayingMetadata,
} from "./player/PlayerPauseOverlay";
import "./VideoPlayer.css";

type Playability = "webview" | "external";

interface VideoPlayerProps {
  url: string;
  /** Human-facing media metadata. Never pass the raw resolved file here when
   * metadata is available. */
  title: string;
  /** Series context shown beneath the show title. */
  subtitle?: string | null;
  /** Optional Detail metadata used by the paused now-playing treatment. */
  nowPlaying?: NowPlayingMetadata | null;
  /** Raw resolved filename, confined to Playback information. */
  sourceFileName?: string | null;
  /** Force a path; when omitted it's sniffed from the URL extension. */
  kind?: Playability;
  /** Explicit renderer identity. Detail always supplies this; inference remains
   * for isolated callers and backwards compatibility. */
  engine?: PlaybackEngine;
  /** Native built-in failure fallback. Called only after libmpv fails, never on
   * the normal native path, so lossless playback starts without transcode delay. */
  requestWebviewFallback?: () => Promise<string | null>;
  onClose: () => void;
  /** Reports playback progress (seconds watched + total duration) so the store
   * can persist a resume position. Called periodically and on close. */
  onProgress?: (
    currentSeconds: number,
    durationSeconds: number | null,
    prefs?: PlaybackPrefs,
  ) => void;
  /** Resume position (seconds) from the saved watch history. The in-webview
   * player seeks here once, on first metadata load - making cross-device resume
   * actually pick up where you left off. 0/undefined starts from the beginning. */
  startPositionSeconds?: number;
  /** Remembered audio/subtitle/speed for this title (in-window player only). */
  savedPrefs?: PlaybackPrefs | null;
  /** Subtitle source (local OpenSubtitles client or the Server-Mode client) when
   * available - powers subtitle search. Null disables the search UI. */
  subtitleClient?: SubtitleClient | null;
  /** Subtitle translator (local or Server-Mode) when available - powers subtitle
   * translation. Null hides the translate action. */
  translator?: Translator | null;
  /** Auto-seed context for the captions search. */
  imdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  /** Next-episode context: when set, an "Up next" card appears at video end.
   *  Null/omitted (movies, finale, setting off) renders nothing. */
  upNext?: { label: string } | null;
  /** Play the next episode (the card's action + the countdown target). */
  onPlayNext?: () => void;
  /** Whether the card auto-plays after a countdown (false under Data Saver - 
   *  nothing plays without a click). */
  autoCountdown?: boolean;
  /** Chosen external player name (Settings). Passed to the VLC/IINA/mpv hand-off
   *  so it opens the user's preferred app first. "" / undefined = auto order. */
  preferredPlayer?: string;
  /** Desktop only (EXPERIMENTAL): use the in-window libmpv player for containers
   *  the webview can't decode (MKV/HEVC) instead of handing off to an external
   *  app. When false the external hand-off (bundled mpv / VLC) is used. Opt-in
   *  (default false) until native bundling is verified. */
  useBuiltInPlayer?: boolean;
}

/** Toggle fullscreen on an element, defensively (the APIs are absent in jsdom
 * and on some webviews - the optional calls then no-op rather than throw). */
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
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    // A focused button/link owns Space/Enter - don't hijack it for play/pause.
    tag === "BUTTON" ||
    tag === "A" ||
    el.isContentEditable
  ) {
    return true;
  }
  const role = el.getAttribute?.("role");
  return (
    role === "button" ||
    role === "link" ||
    role === "menuitem" ||
    role === "checkbox" ||
    role === "switch" ||
    role === "tab"
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

function inferEngine(url: string, kind?: Playability): PlaybackEngine {
  const mode = kind ?? classify(url);
  if (mode === "external") return "native-mpv";
  return url.split("?")[0].toLowerCase().endsWith(".m3u8")
    ? "webview-hls-transcode"
    : "webview-direct";
}

interface WebviewScrubberHandle {
  setCurrentTime(time: number): void;
}

/** Keep media-clock updates local to the scrub bar. Browser `timeupdate` fires
 * about four times per second; captions, help controls, and the video shell do
 * not need to reconcile for each tick. */
const WebviewScrubber = memo(
  forwardRef<
    WebviewScrubberHandle,
    Omit<React.ComponentProps<typeof ScrubBar>, "currentTime">
  >(function WebviewScrubber({ duration, ...props }, ref) {
    const [currentTime, setCurrentTime] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        setCurrentTime(time) {
          setCurrentTime((current) => (current === time ? current : time));
        },
      }),
      [],
    );

    return <ScrubBar {...props} duration={duration} currentTime={currentTime} />;
  }),
);

export function VideoPlayer({
  url,
  title,
  subtitle,
  nowPlaying,
  sourceFileName,
  kind,
  engine,
  requestWebviewFallback,
  onClose,
  onProgress,
  startPositionSeconds,
  savedPrefs,
  subtitleClient,
  translator,
  imdbId,
  season,
  episode,
  upNext = null,
  onPlayNext,
  autoCountdown = true,
  preferredPlayer,
  useBuiltInPlayer = true,
}: VideoPlayerProps) {
  const requestedEngine = engine ?? inferEngine(url, kind);
  const [fallbackSource, setFallbackSource] = useState<{
    originUrl: string;
    originEngine: PlaybackEngine;
    url: string;
  } | null>(null);
  const activeFallback =
    fallbackSource?.originUrl === url &&
    fallbackSource.originEngine === requestedEngine
      ? fallbackSource
      : null;
  const effectiveUrl = activeFallback?.url ?? url;
  const effectiveEngine: PlaybackEngine = activeFallback
    ? "webview-hls-transcode"
    : requestedEngine;
  const mode: Playability =
    effectiveEngine === "native-mpv" ? "external" : "webview";
  const underTauri = isTauri();
  // In-window native player: the DEFAULT desktop path for containers/codecs the
  // webview can't decode (MKV/HEVC). Renders libmpv on a native surface behind the
  // transparent window (see EmbeddedPlayer): macOS = CAOpenGLLayer render API,
  // Windows/Linux = mpv wid-embed. If the surface can't init (e.g. Wayland, or a
  // missing libmpv) the player offers a one-click external hand-off; when the user
  // opts out it's the external hand-off (VLC/IINA/…) directly.
  const dk = deviceKind();
  const useEmbedded =
    underTauri &&
    (dk === "mac" || dk === "windows" || dk === "linux") &&
    mode === "external" &&
    useBuiltInPlayer;
  const [externalStatus, setExternalStatus] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [detailsSection, setDetailsSection] = useState<"info" | "shortcuts" | null>(null);
  const [sourceSize, setSourceSize] = useState<PixelSize | null>(null);
  const [displaySize, setDisplaySize] = useState<PixelSize | null>(() =>
    currentViewportPixelSize(),
  );

  useEffect(() => {
    setSourceSize(null);
    setDetailsSection(null);
  }, [effectiveUrl]);

  useEffect(() => {
    const measure = () => setDisplaySize(currentViewportPixelSize());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // A single top-right panel owns both playback information and the keymap.
  // Escape dismisses it before any lower-level player action can run.
  useEffect(() => {
    if (detailsSection == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDetailsSection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsSection]);

  const recoverNativeInWebview = useCallback(async (): Promise<boolean> => {
    if (requestWebviewFallback == null) return false;
    let hlsUrl: string | null = null;
    try {
      hlsUrl = await requestWebviewFallback();
    } catch {
      hlsUrl = null;
    }
    if (hlsUrl == null || hlsUrl.length === 0) return false;
    setFallbackSource({
      originUrl: url,
      originEngine: requestedEngine,
      url: hlsUrl,
    });
    return true;
  }, [requestWebviewFallback, requestedEngine, url]);

  // Native hand-off when running under Tauri and the in-window player is off.
  // Primary path is the BUNDLED mpv sidecar (shipped + app-controlled over IPC);
  // if mpv isn't available we fall back to the raw VLC/IINA hand-off. On macOS
  // mpv's `--wid` in-window embedding is unreliable, so mpv typically opens its
  // own window - see src-tauri/src/player.rs. mpv is stopped when this closes.
  const startedMpvRef = useRef(false);
  useEffect(() => {
    if (mode !== "external" || !underTauri || useEmbedded) return;
    let cancelled = false;
    startedMpvRef.current = false;

    playWithMpv(effectiveUrl)
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
        // mpv missing / failed to spawn - fall back to the VLC/IINA hand-off.
        if (cancelled) return;
        openInExternalPlayer(effectiveUrl, preferredPlayer)
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
  }, [mode, underTauri, effectiveUrl, preferredPlayer, useEmbedded]);

  // In-window native player takes over the whole window (transparent surface +
  // hidden app chrome), so render it standalone - outside the modal frame.
  if (useEmbedded) {
    const epLabel =
      season != null && episode != null
        ? `S${season} · E${episode}`
        : null;
    return (
      <EmbeddedPlayer
        savedPrefs={savedPrefs}
        url={effectiveUrl}
        title={title}
        subtitle={subtitle ?? epLabel}
        nowPlaying={nowPlaying}
        sourceFileName={sourceFileName}
        engine={effectiveEngine}
        onPlaybackError={recoverNativeInWebview}
        startPositionSeconds={startPositionSeconds}
        onProgress={(current, duration, prefs) =>
          onProgress?.(current, duration, prefs)
        }
        onPlayNext={upNext != null ? onPlayNext : undefined}
        nextLabel={upNext?.label ?? null}
        onClose={onClose}
      />
    );
  }

  // Detail is a fixed, nav-inset surface with backdrop-filter. Filters establish
  // a containing block for fixed descendants, so mounting this shell there would
  // make inset:0 mean "the Detail rect", not the window. Portal every webview and
  // external shell to body, just as EmbeddedPlayer does for its HTML controls.
  return createPortal(
    <div className="player-backdrop" onClick={onClose}>
      <div
        className="player"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-bar">
          <div className="player-title-group">
            <span className="player-title">{title}</span>
            {subtitle && <span className="player-subtitle">{subtitle}</span>}
          </div>
          <div className="player-bar-actions">
            <button
              type="button"
              className="player-info-button"
              onClick={() =>
                setDetailsSection((section) => section === "info" ? null : "info")
              }
              aria-label="Player details and shortcuts"
              aria-haspopup="dialog"
              aria-expanded={detailsSection != null}
              title="Player details and shortcuts (?)"
            >
              <Icon name="info" size={17} />
            </button>
            <button
              type="button"
              className="player-close"
              onClick={onClose}
              aria-label="Close player"
            >
              <Icon name="xmark" size={18} />
            </button>
          </div>
        </div>

        {detailsSection != null && (
          <PlayerInfoPopover
            engine={effectiveEngine}
            sourceSize={sourceSize}
            displaySize={displaySize}
            sourceFileName={sourceFileName}
            section={detailsSection}
            onSectionChange={setDetailsSection}
            shortcuts={WEBVIEW_SHORTCUTS}
            onClose={() => setDetailsSection(null)}
          />
        )}

        {mode === "webview" && externalError == null ? (
          <WebviewPlayer
            url={effectiveUrl}
            title={title}
            nowPlaying={nowPlaying}
            detailsOpen={detailsSection != null}
            onOpenShortcuts={() => setDetailsSection("shortcuts")}
            onSourceSize={setSourceSize}
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
            upNext={upNext}
            onPlayNext={onPlayNext}
            autoCountdown={autoCountdown}
          />
        ) : (
          <ExternalPanel
            underTauri={underTauri}
            url={effectiveUrl}
            status={externalStatus}
            error={externalError}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The in-webview `<video>` path with the custom scrub-thumbnail bar + captions
 * OSD. Split out so the subtitle/thumbnail hooks mount only on this path (never
 * for the external mpv/VLC hand-off, where there's no frame source). */
function WebviewPlayer({
  url,
  title,
  nowPlaying,
  detailsOpen,
  onOpenShortcuts,
  onSourceSize,
  onProgress,
  startPositionSeconds,
  onHlsUnsupported,
  subtitleClient,
  translator,
  imdbId,
  season,
  episode,
  upNext = null,
  onPlayNext,
  autoCountdown = true,
}: {
  url: string;
  title: string;
  nowPlaying?: NowPlayingMetadata | null;
  detailsOpen: boolean;
  onOpenShortcuts: () => void;
  onSourceSize: (size: PixelSize | null) => void;
  onProgress?: (currentSeconds: number, durationSeconds: number | null) => void;
  startPositionSeconds?: number;
  onHlsUnsupported: () => void;
  subtitleClient: SubtitleClient | null;
  translator: Translator | null;
  imdbId: string | null;
  season: number | null;
  episode: number | null;
  upNext?: { label: string } | null;
  onPlayNext?: () => void;
  autoCountdown?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubberRef = useRef<WebviewScrubberHandle | null>(null);
  const [duration, setDuration] = useState(0);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  // Set when the video reaches its natural end - drives the Up-next card.
  const [ended, setEnded] = useState(false);

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
  const onSourceSizeRef = useRef(onSourceSize);
  onSourceSizeRef.current = onSourceSize;
  // Stable ref for the HLS-unsupported callback so the source-attach effect does
  // NOT list a fresh inline arrow in its deps. Detail re-renders every ~5s (the
  // progress → recordResume → refreshHistory loop), and a changing callback
  // identity would otherwise re-run that effect and reload video.src - restarting
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
    onSourceSizeRef.current(null);

    const report = () => {
      const d = Number.isFinite(video.duration) ? video.duration : null;
      onProgressRef.current?.(video.currentTime, d);
    };
    const onTimeUpdate = () => {
      scrubberRef.current?.setCurrentTime(video.currentTime);
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
    // - seeking into an unknown/zero seekable range just gets clamped to 0 and,
    // since we'd have marked it done, would never resume.
    const applyResume = () => {
      if (didSeekRef.current) return;
      const start = startPositionRef.current ?? 0;
      if (start <= 5) {
        didSeekRef.current = true; // nothing meaningful to resume to
        return;
      }
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      if (d <= 0) return; // duration unknown yet (HLS) - retry on durationchange
      if (start >= d - 10) {
        didSeekRef.current = true; // basically finished - don't resume
        return;
      }
      try {
        video.currentTime = start;
        // Only mark the resume done once the seek was accepted - if the element
        // rejects an early seek we leave the guard unset so a later canplay /
        // durationchange retries instead of silently dropping the resume.
        didSeekRef.current = true;
      } catch {
        // Not seekable yet; a subsequent canplay/durationchange will retry.
      }
    };
    const onLoadedMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      const width = video.videoWidth;
      const height = video.videoHeight;
      onSourceSizeRef.current(
        width > 0 && height > 0 ? { width, height } : null,
      );
      applyResume();
    };
    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      applyResume();
    };
    const onEnded = () => setEnded(true);
    const onPause = () => setPaused(true);
    const onPlay = () => setPaused(false);
    setEnded(false); // a new URL is a new playback - clear any stale end state
    setPaused(false);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("canplay", applyResume);
    video.addEventListener("ended", onEnded);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("canplay", applyResume);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      if (onProgressRef.current != null && video.currentTime > 0) report();
    };
  }, [url]);

  // Wire hls.js for HLS streams when the browser can't play them natively.
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;

    if (!isHls) {
      // Only (re)assign on an actual URL change - reassigning the same src
      // invokes the media load algorithm and restarts playback from 0.
      if (video.src !== url) video.src = url;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      if (video.src !== url) video.src = url;
      return;
    }

    // hls.js is ~151 KB gz and is reachable ONLY here: an .m3u8 the browser
    // cannot play natively. A static import pinned it into this chunk, so every
    // player open paid for it - including the native-mpv and direct-file paths
    // that return above and never touch it. Fetch it on demand instead.
    let cancelled = false;
    let instance: HlsInstance | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      // The effect can be torn down (or the URL swapped) while the chunk is in
      // flight; without this we would attach a player to a stale <video>.
      if (cancelled) return;
      const element = videoRef.current;
      if (element == null) return;
      if (!Hls.isSupported()) {
        onHlsUnsupportedRef.current();
        return;
      }
      instance = new Hls();
      instance.loadSource(url);
      instance.attachMedia(element);
    });
    return () => {
      cancelled = true;
      instance?.destroy();
    };
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
      if (match == null) continue; // not one of ours (hls.js-injected) - leave it
      tt.mode = match.id === subs.activeTrackId ? "showing" : "hidden";
    }
  }, [subs.tracks, subs.activeTrackId]);

  const seek = (t: number) => {
    const video = videoRef.current;
    if (video != null && Number.isFinite(t)) {
      video.currentTime = t;
      scrubberRef.current?.setCurrentTime(t);
    }
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
          onOpenShortcuts();
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
  }, [onOpenShortcuts]);

  const resumePlayback = useCallback(() => {
    setPaused(false);
    void videoRef.current?.play();
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

      {paused && !ended && !captionsOpen && !detailsOpen && !scrubbing && (
        <PlayerPauseOverlay
          title={title}
          nowPlaying={nowPlaying}
          onResume={resumePlayback}
        />
      )}

      <div className="player-osd">
        <WebviewScrubber
          key={url}
          ref={scrubberRef}
          duration={duration}
          preview={thumbs.available ? thumbs.preview : null}
          onHover={thumbs.onHover}
          onLeave={thumbs.onLeave}
          onSeek={seek}
          onScrubbingChange={setScrubbing}
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
        </div>
      </div>

      {ended && upNext != null && onPlayNext != null && (
        <UpNextOverlay
          label={upNext.label}
          auto={autoCountdown}
          onPlayNext={onPlayNext}
        />
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
 * by the "?" key or the "?" OSD button - invisible otherwise. */
const WEBVIEW_SHORTCUTS: Array<[string, string]> = [
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

/** "Up next" card at the end of a series episode: shows the next episode's
 * label with Play now / Dismiss. With `auto` (the auto-advance setting, minus
 * Data Saver) it counts down 10s and plays; without, it waits for a click. */
function UpNextOverlay({
  label,
  auto,
  onPlayNext,
}: {
  label: string;
  auto: boolean;
  onPlayNext: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [remaining, setRemaining] = useState(10);
  // The countdown fires through a ref so re-renders during the countdown
  // (polls, seasons landing) always reach the LATEST handler - an interval
  // closure would capture a stale one.
  const onPlayNextRef = useRef(onPlayNext);
  onPlayNextRef.current = onPlayNext;
  useEffect(() => {
    if (!auto || dismissed) return;
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timer);
          onPlayNextRef.current();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    // Cleared on unmount AND on the dismiss re-run - no timer leak, and a
    // dismissed card can never fire.
    return () => clearInterval(timer);
  }, [auto, dismissed]);
  if (dismissed) return null;
  return (
    <div className="player-shortcuts-scrim">
      <div
        className="player-upnext glass-raised"
        role="dialog"
        aria-modal="true"
        aria-label={`Next episode: ${label}`}
      >
        <span className="player-upnext-title t-secondary">Up next</span>
        <span className="player-upnext-label">{label}</span>
        {auto && (
          <span className="player-upnext-count t-secondary" aria-live="polite">
            Playing in {remaining}s
          </span>
        )}
        <div className="player-upnext-actions">
          <button type="button" className="btn btn-prominent" onClick={onPlayNext}>
            <Icon name="play" size={14} />
            Play now
          </button>
          <button type="button" className="btn" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
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
