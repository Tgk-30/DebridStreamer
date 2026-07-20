// EmbeddedPlayer - the built-in libmpv player. Video renders on a native
// Metal/GL surface BEHIND the transparent webview; this component draws a
// premium control layer on top and drives libmpv over IPC (tauri-plugin-libmpv).
// Handles any container (MKV/HEVC/AV1) losslessly, unlike the <video> webview.
//
// Beyond a basic player: audio/subtitle track menus, playback speed, chapter
// navigation (with scrubber markers), buffered range, hover scrub preview,
// subtitle + audio sync, real fullscreen, gestures, and a full keyboard map.

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  init,
  destroy,
  command,
  setProperty,
  getProperty,
  observeProperties,
  setVideoMarginRatio,
  type MpvConfig,
  type MpvObservableProperty,
} from "../lib/renderPlayer";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openInExternalPlayer } from "../lib/tauri";
import {
  currentViewportPixelSize,
  type PixelSize,
  type PlaybackEngine,
} from "../lib/playbackEngine";
import type { PlaybackPrefs } from "../storage/models";
import { Icon } from "./Icon";
import { CastControls } from "./CastControls";
import { PlayerInfoPopover } from "./player/PlayerInfoPopover";
import {
  PlayerPauseOverlay,
  type NowPlayingMetadata,
} from "./player/PlayerPauseOverlay";
import {
  scrobblePlaybackPause,
  scrobblePlaybackStart,
  scrobblePlaybackStop,
  type TraktScrobbleContext,
} from "../data/traktScrobble";
import "./EmbeddedPlayer.css";

interface Props {
  url: string;
  title: string;
  /** Optional secondary line (e.g. "S2 · E5 · Episode title"). */
  subtitle?: string | null;
  /** Optional Detail metadata used by the paused now-playing treatment. */
  nowPlaying?: NowPlayingMetadata | null;
  /** Raw resolved source name. Keep it in Playback information, not the title
   * bar, so human media metadata remains the playback context. */
  sourceFileName?: string | null;
  /** Short-lived server stream capability, passed outside the media URL. */
  playbackAuthorization?: string;
  startPositionSeconds?: number;
  /** Remembered audio/subtitle/speed for this title, restored after load. */
  savedPrefs?: PlaybackPrefs | null;
  /** Throttled progress + the current player prefs - feeds Continue Watching and
   * persists the audio/sub/speed choices for next time. */
  onProgress?: (current: number, duration: number, prefs?: PlaybackPrefs) => void;
  /** Present for a series with a next episode - shows an "Up next" affordance. */
  onPlayNext?: () => void;
  nextLabel?: string | null;
  /** Renderer identity shown in the permanent playback-info popover. */
  engine?: PlaybackEngine;
  /** Give the parent one chance to switch to a compatible webview source when
   * native initialization or loading fails. Returning true means it recovered. */
  onPlaybackError?: (error: Error) => boolean | Promise<boolean>;
  /** Immutable TMDB playback identity, snapshotted by Detail when Play opens. */
  scrobbleContext?: TraktScrobbleContext | null;
  onClose: () => void;
}

/** One selectable mpv track (audio or subtitle). */
interface Track {
  id: number;
  type: "audio" | "sub" | "video";
  title: string;
  lang: string | null;
  selected: boolean;
  codec: string | null;
  external: boolean;
  sourceUrl: string | null;
}
interface Chapter {
  title: string;
  time: number;
}

const OBSERVED: readonly MpvObservableProperty[] = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  // paused-for-cache is true ONLY when playback stalls waiting for the network
  // cache (the real "debrid is buffering" signal). We deliberately do NOT observe
  // core-idle: it's also true on every user pause + at EOF, which made the
  // buffering spinner appear over paused frames.
  ["paused-for-cache", "flag"],
  ["volume", "double", "none"],
  ["mute", "flag"],
  ["speed", "double", "none"],
  ["demuxer-cache-time", "double", "none"],
  ["aid", "string", "none"],
  ["sid", "string", "none"],
  ["eof-reached", "flag"],
  // Raw decoded dimensions power the permanent diagnostics. dwidth/dheight are
  // retained as a fallback for mpv builds that do not emit video-params subkeys.
  ["video-params/w", "int64", "none"],
  ["video-params/h", "int64", "none"],
  ["dwidth", "int64", "none"],
  ["dheight", "int64", "none"],
];

const MPV_CONFIG: MpvConfig = {
  initialOptions: {
    // Video output, hardware decode, scaling, debanding, cache and subtitle
    // pickup are all chosen PER-OS by the Rust core (best_in_class_options) - a JS
    // override here would silently win over the platform-correct default (that's
    // the bug that pinned macOS to auto-safe software decode + a 150MiB cache).
    // Only set options the Rust side does NOT own:
    "keep-open": "yes", // don't tear down the render surface at EOF (end card)
    "sub-font-size": 44, // plain SRT/text subs; ASS keeps its own styling
    terminal: "no",
  },
  observedProperties: OBSERVED,
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const;
/** No reserved margin - the video fills edge-to-edge and centers; the control
 *  bar overlays it on a gradient scrim (like every modern streaming player). */
const VIDEO_MARGIN_BOTTOM = 0;

/** A file mpv ACCEPTS (loadfile succeeds) can still never decode a frame - no
 *  time-pos ever arrives - when the data is corrupt or the codec is one this
 *  build can't handle. The initial spinner would then spin forever with no error
 *  and no fallback. If we're still pre-first-frame this long after loadfile, we
 *  treat it as a native failure and hand off to the webview HLS transcode. This
 *  is the backstop; an mpv end-file ERROR event closes the common case faster.
 *  25s (not 10): a high-bitrate 4K debrid stream through a home-server proxy
 *  legitimately needs longer to probe and fill before the first frame, and the
 *  timer is re-armed whenever demuxer data is still flowing, so this only ever
 *  fires for genuinely dead streams. */
const FIRST_FRAME_WATCHDOG_MS = 25_000;
/** The native event stream may run at display cadence. The seek UI does not
 * need that precision, and keeping it at 5Hz leaves the rest of the chrome
 * completely out of the playback hot path. */
const SCRUBBER_UPDATE_INTERVAL_MS = 200;

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Return the Trakt percentage at a lifecycle event, never from a progress tick. */
function playbackProgressPct(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (current / duration) * 100));
}

/** Parse mpv's `track-list` node into our typed tracks. */
function parseTracks(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return [];
  const out: Track[] = [];
  for (const t of raw as Array<Record<string, unknown>>) {
    const type = t.type;
    if (type !== "audio" && type !== "sub" && type !== "video") continue;
    const id = typeof t.id === "number" ? t.id : Number(t.id);
    if (!Number.isFinite(id)) continue;
    const lang = typeof t.lang === "string" ? t.lang : null;
    const rawTitle = typeof t.title === "string" ? t.title : "";
    out.push({
      id,
      type,
      title: rawTitle,
      lang,
      selected: t.selected === true,
      codec: typeof t.codec === "string" ? t.codec : null,
      external: t.external === true,
      sourceUrl:
        typeof t["external-filename"] === "string" &&
        /^https?:\/\//i.test(t["external-filename"])
          ? t["external-filename"]
          : null,
    });
  }
  return out;
}

/** A human label for a track: its title, else language, else "Track N". */
function trackLabel(t: Track, index: number): string {
  const bits: string[] = [];
  if (t.title) bits.push(t.title);
  if (t.lang) bits.push(t.lang.toUpperCase());
  if (bits.length === 0) bits.push(`Track ${index + 1}`);
  const suffix = t.codec ? ` · ${t.codec}` : "";
  return bits.join(" · ") + suffix;
}

function parseChapters(raw: unknown): Chapter[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((c, i) => ({
      title: typeof c.title === "string" && c.title ? c.title : `Chapter ${i + 1}`,
      time: typeof c.time === "number" ? c.time : Number(c.time) || 0,
    }))
    .filter((c) => Number.isFinite(c.time));
}

/** Let focused sliders, menu buttons, and text inputs keep their native keys.
 * Escape remains global so overlay layering is predictable. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el == null) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.tagName === "BUTTON" ||
    el.isContentEditable
  );
}

type MenuId = "audio" | "sub" | "speed" | "chapters" | "settings" | null;

interface NativeScrubberHandle {
  updatePlayback(
    next: Partial<{ pos: number; bufferedTo: number }>,
    immediate?: boolean,
  ): void;
}

interface NativeScrubberProps {
  duration: number;
  chapters: Chapter[];
  active: boolean;
  onSeek: (time: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
}

/**
 * The only player-chrome leaf which updates while playback advances. mpv can
 * report time and cache changes independently and much faster than a seek bar
 * can visibly change, so merge both into one capped state update here. When
 * the controls are hidden we retain only the latest refs and do no React work;
 * showing the controls flushes that latest value immediately.
 */
const NativeScrubber = memo(
  forwardRef<NativeScrubberHandle, NativeScrubberProps>(function NativeScrubber(
    { duration, chapters, active, onSeek, onScrubbingChange },
    ref,
  ) {
    const [playback, setPlayback] = useState({ pos: 0, bufferedTo: 0 });
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
    const [showTotalDuration, setShowTotalDuration] = useState(false);
    const scrubRef = useRef<HTMLDivElement | null>(null);
    const pendingRef = useRef(playback);
    const activeRef = useRef(active);
    const timerRef = useRef<number | undefined>(undefined);

    activeRef.current = active;

    const flush = useCallback(() => {
      timerRef.current = undefined;
      if (!activeRef.current) return;
      const next = pendingRef.current;
      setPlayback((current) =>
        current.pos === next.pos && current.bufferedTo === next.bufferedTo
          ? current
          : next,
      );
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        updatePlayback(next, immediate = false) {
          pendingRef.current = { ...pendingRef.current, ...next };
          if (!activeRef.current && !immediate) return;
          if (immediate) {
            window.clearTimeout(timerRef.current);
            flush();
            return;
          }
          if (timerRef.current == null) {
            timerRef.current = window.setTimeout(flush, SCRUBBER_UPDATE_INTERVAL_MS);
          }
        },
      }),
      [flush],
    );

    useEffect(() => {
      if (active) flush();
      else window.clearTimeout(timerRef.current);
    }, [active, flush]);
    useEffect(
      () => () => window.clearTimeout(timerRef.current),
      [],
    );

    const timeAtClientX = useCallback(
      (clientX: number): number => {
        const el = scrubRef.current;
        if (el == null || duration <= 0) return 0;
        const rect = el.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return fraction * duration;
      },
      [duration],
    );
    const pct = (value: number) =>
      duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0;

    return (
      <div className="embed-scrub-row">
        <span className="embed-time">{fmt(playback.pos)}</span>
        <div
          className="embed-scrub"
          ref={scrubRef}
          onPointerDown={(event) => {
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            onScrubbingChange?.(true);
            onSeek(timeAtClientX(event.clientX));
          }}
          onPointerMove={(event) => {
            const time = timeAtClientX(event.clientX);
            if (event.buttons === 1) onSeek(time);
            setHover({ x: event.clientX, t: time });
          }}
          onPointerUp={() => onScrubbingChange?.(false)}
          onPointerCancel={() => onScrubbingChange?.(false)}
          onPointerLeave={(event) => {
            setHover(null);
            if (event.buttons !== 1) onScrubbingChange?.(false);
          }}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(playback.pos)}
          tabIndex={0}
        >
          <div className="embed-scrub-track">
            <div
              className="embed-scrub-buffered"
              style={{ width: `${pct(Math.max(playback.bufferedTo, playback.pos))}%` }}
            />
            <div className="embed-scrub-played" style={{ width: `${pct(playback.pos)}%` }} />
            {chapters.length > 1 &&
              chapters.map((chapter, index) => (
                <span
                  key={index}
                  className="embed-scrub-chapter"
                  style={{ left: `${pct(chapter.time)}%` }}
                  title={chapter.title}
                />
              ))}
            <div className="embed-scrub-thumb" style={{ left: `${pct(playback.pos)}%` }} />
          </div>
          {hover && (
            <div
              className="embed-scrub-hover"
              style={{ left: `${Math.min(100, Math.max(0, pct(hover.t)))}%` }}
            >
              {fmt(hover.t)}
            </div>
          )}
        </div>
        <button
          type="button"
          className="embed-time embed-time-toggle"
          onClick={() => setShowTotalDuration((showingTotal) => !showingTotal)}
          aria-label={showTotalDuration ? "Show remaining time" : "Show total duration"}
          title={showTotalDuration ? "Show remaining time" : "Show total duration"}
        >
          {showTotalDuration
            ? fmt(duration)
            : `-${fmt(Math.max(0, duration - playback.pos))}`}
        </button>
      </div>
    );
  }),
);

function chapterIndexAt(pos: number, chapters: readonly Chapter[]): number {
  for (let index = chapters.length - 1; index >= 0; index -= 1) {
    if (pos >= chapters[index].time) return index;
  }
  return -1;
}

export function EmbeddedPlayer({
  url,
  title,
  subtitle,
  nowPlaying,
  sourceFileName,
  playbackAuthorization,
  startPositionSeconds = 0,
  savedPrefs,
  onProgress,
  onPlayNext,
  nextLabel,
  engine = "native-mpv",
  onPlaybackError,
  scrobbleContext = null,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<MenuId>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeAid, setActiveAid] = useState<string>("auto");
  const [activeSid, setActiveSid] = useState<string>("auto");
  const [subDelay, setSubDelay] = useState(0);
  const [audioDelay, setAudioDelay] = useState(0);
  const [subScale, setSubScale] = useState(1);
  const [ended, setEnded] = useState(false);
  const [activeChapterIndex, setActiveChapterIndex] = useState(-1);
  const [detailsSection, setDetailsSection] = useState<"info" | "shortcuts" | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [castSuspended, setCastSuspended] = useState(false);
  // Source dimensions are diagnostic only. Player chrome is deliberately never
  // fitted to this rectangle: it belongs to the window, while mpv owns genuine
  // source-aspect letterboxing inside its full-window native surface.
  const [sourceW, setSourceW] = useState(0);
  const [sourceH, setSourceH] = useState(0);
  const [videoW, setVideoW] = useState(0);
  const [videoH, setVideoH] = useState(0);
  const [displaySize, setDisplaySize] = useState<PixelSize | null>(() =>
    currentViewportPixelSize(),
  );

  const startedRef = useRef(false);
  // Cleared once the first frame is shown; until then the initial buffering=true
  // (the debrid fetch) stays up, and an early paused-for-cache=false can't clear it.
  const firstFrameRef = useRef(false);
  const lastReportRef = useRef(0);
  const posRef = useRef(0);
  const durRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onPlaybackErrorRef.current = onPlaybackError;
  const hideTimer = useRef<number | undefined>(undefined);
  const stageClickTimer = useRef<number | undefined>(undefined);
  const scrubberRef = useRef<NativeScrubberHandle | null>(null);
  const activeChapterIndexRef = useRef(-1);
  const pausedRef = useRef(paused);
  const endedRef = useRef(false);
  const lastAudibleVolume = useRef(100);
  const menuOpenRef = useRef(false);
  const wasCastSuspendedRef = useRef(false);
  const castSuspendedRef = useRef(castSuspended);
  const pausedBeforeCastRef = useRef(false);
  menuOpenRef.current = menu != null || detailsSection != null;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  durRef.current = dur;
  pausedRef.current = paused;
  castSuspendedRef.current = castSuspended;

  const audioTracks = useMemo(() => tracks.filter((t) => t.type === "audio"), [tracks]);
  const subTracks = useMemo(() => tracks.filter((t) => t.type === "sub"), [tracks]);
  const activeSubtitleUrl = useMemo(
    () =>
      subTracks.find((track) => String(track.id) === activeSid)?.sourceUrl ??
      null,
    [activeSid, subTracks],
  );

  useEffect(() => {
    if (castSuspended && !wasCastSuspendedRef.current) {
      pausedBeforeCastRef.current = pausedRef.current;
      void setProperty("pause", true).catch(() => {});
    } else if (!castSuspended && wasCastSuspendedRef.current) {
      if (!pausedBeforeCastRef.current) {
        void setProperty("pause", false).catch(() => {});
      }
    }
    wasCastSuspendedRef.current = castSuspended;
  }, [castSuspended]);

  // Page transparent + app UI hidden so the native mpv surface shows through.
  useEffect(() => {
    document.documentElement.classList.add("mpv-active");
    return () => document.documentElement.classList.remove("mpv-active");
  }, []);

  // Track the full-window native surface for the diagnostic popover. Backing
  // pixels make this directly comparable to mpv's decoded source dimensions.
  useEffect(() => {
    const measure = () => setDisplaySize(currentViewportPixelSize());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Refresh the track + chapter lists from mpv (after load, and on menu open).
  const refreshTracks = useCallback(async () => {
    try {
      const raw = await getProperty("track-list", "node");
      setTracks(parseTracks(raw));
    } catch {
      /* ignore - menu just shows "none" */
    }
  }, []);
  const refreshChapters = useCallback(async () => {
    try {
      const raw = await getProperty("chapter-list", "node");
      const nextChapters = parseChapters(raw);
      setChapters(nextChapters);
      const nextChapterIndex = chapterIndexAt(posRef.current, nextChapters);
      if (activeChapterIndexRef.current !== nextChapterIndex) {
        activeChapterIndexRef.current = nextChapterIndex;
        setActiveChapterIndex(nextChapterIndex);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ── libmpv lifecycle: init → observe → load; destroy on unmount ────────────
  useEffect(() => {
    let cancelled = false;
    // A single gate so the three native-failure signals - an init/loadfile throw,
    // an mpv end-file ERROR event, and the first-frame watchdog - can each request
    // the webview fallback, but only the FIRST one does (later ones no-op).
    let fallbackTried = false;
    // Armed after loadfile; fires if no first frame arrives in time.
    let watchdog: number | undefined;
    firstFrameRef.current = false; // new file: show the initial spinner again
    endedRef.current = false;
    posRef.current = 0;
    durRef.current = 0;
    scrubberRef.current?.updatePlayback({ pos: 0, bufferedTo: 0 }, true);
    activeChapterIndexRef.current = -1;
    setActiveChapterIndex(-1);
    setSourceW(0);
    setSourceH(0);
    setVideoW(0);
    setVideoH(0);
    let unlisten: (() => void) | undefined;

    // Route every native-failure signal through one place: ask the parent to
    // switch to a compatible webview source (the HLS transcode, which is handed
    // the SAME startPositionSeconds, so resume is preserved across the swap), and
    // only when it can't recover fall through to the built-in error card. Runs at
    // most once per file - a decode error and the watchdog can't double-fire it.
    const triggerNativeFallback = async (err: Error): Promise<void> => {
      if (cancelled || fallbackTried) return;
      fallbackTried = true;
      window.clearTimeout(watchdog); // a concrete signal supersedes the watchdog
      let recovered = false;
      if (onPlaybackErrorRef.current != null) {
        try {
          recovered = (await onPlaybackErrorRef.current(err)) === true;
        } catch {
          // The native error card remains the terminal fallback.
        }
      }
      if (!cancelled && !recovered) setError(err.message);
    };

    // (Re-)arm the first-frame watchdog. Called after loadfile and again on
    // every demuxer-progress event, so only a genuinely stalled stream trips
    // it - slow-but-flowing 4K debrid links keep resetting the clock.
    const armWatchdog = (): void => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (cancelled || firstFrameRef.current) return;
        void triggerNativeFallback(
          new Error("Native playback produced no frame in time"),
        );
      }, FIRST_FRAME_WATCHDOG_MS);
    };

    void (async () => {
      try {
        await init(MPV_CONFIG);
        if (cancelled) {
          void destroy().catch(() => {});
          return;
        }
        await setVideoMarginRatio({ bottom: VIDEO_MARGIN_BOTTOM });
        unlisten = await observeProperties(
          OBSERVED,
          (ev: { name: string; data: unknown }) => {
            // A late event can arrive after unmount (before unlisten lands) or
            // after the guarded teardown - never touch state on a dead component.
            if (cancelled) return;
            switch (ev.name) {
              case "pause":
                setPaused(Boolean(ev.data));
                if (scrobbleContext != null) {
                  if (ev.data === true && !endedRef.current) {
                    scrobblePlaybackPause(
                      scrobbleContext,
                      playbackProgressPct(posRef.current, durRef.current),
                    );
                  } else if (ev.data === false && startedRef.current) {
                    scrobblePlaybackStart({
                      ...scrobbleContext,
                      progressPct: playbackProgressPct(posRef.current, durRef.current),
                    });
                  }
                }
                break;
              case "time-pos":
                if (typeof ev.data === "number") {
                  // Keep command/keyboard math exact at native event cadence,
                  // while NativeScrubber coalesces its React state to 5Hz.
                  posRef.current = ev.data;
                  scrubberRef.current?.updatePlayback({ pos: ev.data });
                  if (chaptersRef.current.length > 0) {
                    const nextChapterIndex = chapterIndexAt(
                      ev.data,
                      chaptersRef.current,
                    );
                    if (activeChapterIndexRef.current !== nextChapterIndex) {
                      activeChapterIndexRef.current = nextChapterIndex;
                      setActiveChapterIndex(nextChapterIndex);
                    }
                  }
                  // First position report ≈ first frame shown → drop the
                  // initial-load spinner and stand the watchdog down.
                  if (!firstFrameRef.current) {
                    firstFrameRef.current = true;
                    setBuffering(false);
                    window.clearTimeout(watchdog);
                    if (scrobbleContext != null) {
                      scrobblePlaybackStart({
                        ...scrobbleContext,
                        progressPct: playbackProgressPct(posRef.current, durRef.current),
                      });
                    }
                  }
                  const now = Date.now();
                  if (
                    startedRef.current &&
                    durRef.current > 0 &&
                    now - lastReportRef.current >= 5000
                  ) {
                    lastReportRef.current = now;
                    onProgressRef.current?.(
                      posRef.current,
                      durRef.current,
                      prefsRef.current,
                    );
                  }
                }
                break;
              case "duration":
                if (typeof ev.data === "number") {
                  durRef.current = ev.data;
                  setDur(ev.data);
                }
                break;
              case "paused-for-cache":
                // Only a real cache stall (after playback has started) toggles the
                // spinner; before the first frame the initial spinner owns it.
                if (firstFrameRef.current) setBuffering(Boolean(ev.data));
                break;
              case "volume":
                if (typeof ev.data === "number") {
                  const nextVolume = Math.round(ev.data);
                  setVolume(nextVolume);
                  if (nextVolume > 0) lastAudibleVolume.current = nextVolume;
                }
                break;
              case "mute":
                setMuted(Boolean(ev.data));
                break;
              case "speed":
                if (typeof ev.data === "number") setSpeed(ev.data);
                break;
              case "demuxer-cache-time":
                // Absolute timestamp of the last buffered demuxer data (the
                // time-ahead quantity is demuxer-cache-duration, a different
                // property), so it maps directly onto the seek bar.
                if (typeof ev.data === "number") {
                  scrubberRef.current?.updatePlayback({
                    bufferedTo: Math.max(0, ev.data),
                  });
                  // Data is still flowing: the stream is alive, just slow.
                  // Re-arm the first-frame watchdog so big debrid remuxes get
                  // their full probe time instead of a false failure.
                  if (!firstFrameRef.current) armWatchdog();
                }
                break;
              case "aid":
                setActiveAid(ev.data == null ? "no" : String(ev.data));
                break;
              case "sid":
                setActiveSid(ev.data == null ? "no" : String(ev.data));
                break;
              case "eof-reached":
                if (ev.data === true) {
                  endedRef.current = true;
                  setEnded(true);
                  if (scrobbleContext != null) {
                    scrobblePlaybackStop(
                      scrobbleContext,
                      playbackProgressPct(posRef.current, durRef.current),
                    );
                  }
                }
                break;
              // A genuine playback FAILURE reported by mpv AFTER loadfile
              // succeeded (corrupt data / an undecodable codec) - the case the
              // init try/catch can't see, because loadfile returns success and the
              // decode error only surfaces here. Only reason=ERROR reaches us (the
              // Rust core never forwards a normal EOF/stop/quit/redirect), so any
              // end-file event is a hand-off to the webview transcode.
              case "end-file": {
                const d = ev.data as { error?: boolean; code?: number } | null;
                if (d?.error) {
                  void triggerNativeFallback(
                    new Error(
                      `Native playback failed (mpv error ${d.code ?? "unknown"})`,
                    ),
                  );
                }
                break;
              }
              case "video-params/w":
                if (typeof ev.data === "number") setSourceW(ev.data);
                break;
              case "video-params/h":
                if (typeof ev.data === "number") setSourceH(ev.data);
                break;
              case "dwidth":
                if (typeof ev.data === "number") setVideoW(ev.data);
                break;
              case "dheight":
                if (typeof ev.data === "number") setVideoH(ev.data);
                break;
            }
          },
        );
        const resumeSeconds =
          Number.isFinite(startPositionSeconds) && startPositionSeconds > 5
            ? Math.floor(startPositionSeconds)
            : null;
        setEnded(false);
        // mpv 0.38 inserted a playlist-index argument before the per-file options
        // argument. Even with `replace`, the ignored index slot must be present or
        // `start=+N` is parsed as an integer index and rejected with Raw(-4).
        const loadArgs =
          resumeSeconds == null
            ? [url]
            : [url, "replace", "-1", `start=+${resumeSeconds}`];
        const loadOnce = () =>
          playbackAuthorization == null
            ? command("loadfile", loadArgs)
            : command("loadfile", loadArgs, playbackAuthorization);
        try {
          await loadOnce();
        } catch {
          // One silent retry: debrid CDNs and proxies throw transient errors on
          // first touch (cold cache, 502s) that a fresh attempt clears, and
          // these used to count as instant player failures.
          await new Promise((r) => setTimeout(r, 800));
          if (cancelled) return;
          await loadOnce();
        }
        await setProperty("pause", false);
        if (castSuspendedRef.current) {
          await setProperty("pause", true);
        }
        startedRef.current = true;
        // Arm the first-frame watchdog. loadfile has been accepted, but mpv can
        // still stall forever without ever decoding a frame; if we're still
        // pre-first-frame after the window (and no demuxer progress re-arms
        // it), hand off to the webview transcode.
        armWatchdog();
        // Tracks/chapters populate a beat after the file loads.
        window.setTimeout(() => {
          if (!cancelled) {
            void refreshTracks();
            void refreshChapters();
          }
        }, 700);
      } catch (e) {
        const playbackError = e instanceof Error ? e : new Error(String(e));
        await triggerNativeFallback(playbackError);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      unlisten?.();
      void destroy().catch(() => {});
      if (scrobbleContext != null) {
        scrobblePlaybackStop(
          scrobbleContext,
          playbackProgressPct(posRef.current, durRef.current),
        );
      }
    };
  }, [
    url,
    playbackAuthorization,
    startPositionSeconds,
    refreshTracks,
    refreshChapters,
    scrobbleContext,
  ]);

  // Keep the current player prefs in a ref so the throttled/unmount progress
  // writes can persist them without re-subscribing on every track/speed change.
  const prefsRef = useRef<PlaybackPrefs>({});
  useEffect(() => {
    prefsRef.current = {
      preferredAudioId: activeAid,
      preferredAudioLang:
        audioTracks.find((t) => String(t.id) === activeAid)?.lang ?? null,
      preferredSubId: activeSid,
      playbackSpeed: speed,
    };
  }, [activeAid, activeSid, speed, audioTracks]);

  // ── Auto-hide controls + cursor while playing (kept up while a menu is open)
  const nudgeControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (
        pausedRef.current ||
        menuOpenRef.current ||
        !posRef.current ||
        durRef.current === 0
      ) {
        return;
      }
      setControlsVisible(false);
    }, 3200);
  }, []);
  useEffect(() => {
    nudgeControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [nudgeControls]);
  useEffect(() => {
    if (paused) {
      window.clearTimeout(hideTimer.current);
      setControlsVisible(true);
      return;
    }
    nudgeControls();
  }, [paused, nudgeControls]);

  // ── Playback controls ──────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (ended) {
      setEnded(false);
      endedRef.current = false;
      void command("seek", [0, "absolute"]);
      void setProperty("pause", false);
      return;
    }
    setPaused((current) => !current);
    void setProperty("pause", !paused);
    nudgeControls();
  }, [paused, ended, nudgeControls]);

  const seekTo = useCallback((to: number) => {
    const next = Math.max(0, to);
    posRef.current = next;
    scrubberRef.current?.updatePlayback({ pos: next }, true);
    const nextChapterIndex = chapterIndexAt(next, chaptersRef.current);
    if (activeChapterIndexRef.current !== nextChapterIndex) {
      activeChapterIndexRef.current = nextChapterIndex;
      setActiveChapterIndex(nextChapterIndex);
    }
    setEnded(false);
    endedRef.current = false;
    void command("seek", [next, "absolute"]);
  }, []);

  const relSeek = useCallback(
    (delta: number) => {
      setEnded(false);
      endedRef.current = false;
      void command("seek", [delta, "relative"]);
      nudgeControls();
    },
    [nudgeControls],
  );

  const changeVolume = useCallback((v: number) => {
    const next = Math.min(130, Math.max(0, Math.round(v)));
    setVolume(next);
    setMuted(next === 0);
    if (next > 0) lastAudibleVolume.current = next;
    void setProperty("volume", next);
    void setProperty("mute", next === 0);
  }, []);
  const toggleMute = useCallback(() => {
    if (muted || volume === 0) {
      const restored = Math.max(1, lastAudibleVolume.current);
      setMuted(false);
      setVolume(restored);
      void setProperty("mute", false);
      void setProperty("volume", restored);
      return;
    }
    lastAudibleVolume.current = volume;
    setMuted(true);
    void setProperty("mute", true);
  }, [muted, volume]);

  const applySpeed = useCallback((s: number) => {
    setSpeed(s);
    void setProperty("speed", s);
  }, []);

  const selectAudio = useCallback((id: string) => {
    setActiveAid(id);
    void setProperty("aid", id);
  }, []);
  const selectSub = useCallback((id: string) => {
    setActiveSid(id);
    void setProperty("sid", id);
  }, []);

  // Restore remembered audio/subtitle/speed once, after the track list loads.
  const restoredRef = useRef(false);
  useEffect(() => {
    restoredRef.current = false;
  }, [url]);
  useEffect(() => {
    if (restoredRef.current || !savedPrefs || tracks.length === 0) return;
    restoredRef.current = true;
    if (savedPrefs.playbackSpeed && savedPrefs.playbackSpeed > 0) {
      applySpeed(savedPrefs.playbackSpeed);
    }
    // Audio: match by language first (survives id re-ordering across sources),
    // then by exact id.
    const wantAudio =
      audioTracks.find((t) => t.lang && t.lang === savedPrefs.preferredAudioLang) ??
      audioTracks.find((t) => String(t.id) === savedPrefs.preferredAudioId);
    if (wantAudio) selectAudio(String(wantAudio.id));
    // Subtitle: "no" = explicitly off; otherwise match id, else language.
    if (savedPrefs.preferredSubId === "no") {
      selectSub("no");
    } else if (savedPrefs.preferredSubId != null) {
      const wantSub =
        subTracks.find((t) => String(t.id) === savedPrefs.preferredSubId) ??
        subTracks.find((t) => t.lang && t.lang === savedPrefs.preferredSubId);
      if (wantSub) selectSub(String(wantSub.id));
    }
  }, [tracks, savedPrefs, audioTracks, subTracks, applySpeed, selectAudio, selectSub]);

  const jumpChapter = useCallback((time: number) => {
    seekTo(time);
    setMenu(null);
  }, [seekTo]);

  const applySubDelay = useCallback((d: number) => {
    setSubDelay(d);
    void setProperty("sub-delay", d);
  }, []);
  const applyAudioDelay = useCallback((d: number) => {
    setAudioDelay(d);
    void setProperty("audio-delay", d);
  }, []);
  const applySubScale = useCallback((s: number) => {
    setSubScale(s);
    void setProperty("sub-scale", s);
  }, []);

  const syncFullscreen = useCallback(async () => {
    const actual = await getCurrentWindow().isFullscreen();
    setFullscreen(actual);
    return actual;
  }, []);

  const toggleFullscreen = useCallback(() => {
    void (async () => {
      try {
        // Read the native state immediately before toggling. The green window
        // control and Escape can change it independently of React state.
        const current = await syncFullscreen();
        const next = !current;
        await getCurrentWindow().setFullscreen(next);
        setFullscreen(next);
        setFullscreenError(null);
      } catch (error) {
        // Surface a bridge or ACL failure instead of leaving an optimistic icon
        // that claims the window entered fullscreen when it did not.
        setFullscreenError(
          `Fullscreen could not be changed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        try {
          await syncFullscreen();
        } catch {
          // The visible error above is the actionable diagnostic.
        }
      }
    })();
  }, [syncFullscreen]);

  // Delay a stage click just long enough to distinguish a single click from a
  // double click. Without this, a double click pauses before entering
  // fullscreen, which reads as a flicker in the native surface.
  const handleStageClick = useCallback(() => {
    if (menu != null) {
      setMenu(null);
      return;
    }
    if (detailsSection != null) {
      setDetailsSection(null);
      return;
    }
    window.clearTimeout(stageClickTimer.current);
    stageClickTimer.current = window.setTimeout(() => {
      togglePause();
    }, 220);
  }, [detailsSection, menu, togglePause]);
  const handleStageDoubleClick = useCallback(() => {
    window.clearTimeout(stageClickTimer.current);
    toggleFullscreen();
  }, [toggleFullscreen]);
  useEffect(
    () => () => window.clearTimeout(stageClickTimer.current),
    [],
  );

  const doClose = useCallback(() => {
    if (fullscreen) {
      void getCurrentWindow().setFullscreen(false).catch((error) => {
        setFullscreenError(
          `Fullscreen could not be changed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    if (startedRef.current && durRef.current > 0) {
      onProgress?.(posRef.current, durRef.current, prefsRef.current);
    }
    if (scrobbleContext != null) {
      scrobblePlaybackStop(
        scrobbleContext,
        playbackProgressPct(posRef.current, durRef.current),
      );
    }
    onClose();
  }, [onClose, onProgress, fullscreen, scrobbleContext]);

  // Keep the current window's real fullscreen state in sync (Esc, green button).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void syncFullscreen().catch(() => {});
    void getCurrentWindow()
      .onResized(() => {
        void syncFullscreen().catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [syncFullscreen]);

  const openMenu = useCallback(
    (id: Exclude<MenuId, null>) => {
      setMenu((cur) => (cur === id ? null : id));
      if (id === "audio" || id === "sub") void refreshTracks();
      if (id === "chapters") void refreshChapters();
      nudgeControls();
    },
    [refreshTracks, refreshChapters, nudgeControls],
  );

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (castSuspendedRef.current) return;
      // Escape owns the player-level dismissal ladder. Capture it before a
      // hidden chrome control or the transparent native-video surface can let
      // the WebView's default Escape handling consume the first press.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (detailsSection != null) setDetailsSection(null);
        else if (menu != null) setMenu(null);
        else if (fullscreen) toggleFullscreen();
        else doClose();
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePause();
          break;
        case "ArrowRight":
          e.preventDefault();
          relSeek(e.shiftKey ? 60 : 10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          relSeek(e.shiftKey ? -60 : -10);
          break;
        case "l":
          relSeek(30);
          break;
        case "j":
          relSeek(-30);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(130, volume + 5));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 5));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "c":
          // Cycle subtitle track (off → first → next …).
          void command("cycle", ["sub"]);
          void refreshTracks();
          break;
        case "<":
        case ",":
          applySpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) - 1)] ?? 1);
          break;
        case ">":
        case ".":
          applySpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1)] ?? 1);
          break;
        case "?":
          setDetailsSection((section) =>
            section === "shortcuts" ? null : "shortcuts",
          );
          break;
        default:
          if (/^[0-9]$/.test(e.key) && durRef.current > 0) {
            seekTo((Number(e.key) / 10) * durRef.current);
          }
      }
      nudgeControls();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    togglePause, relSeek, changeVolume, volume, toggleMute, toggleFullscreen,
    applySpeed, speed, doClose, seekTo, nudgeControls, menu, fullscreen,
    detailsSection, refreshTracks,
  ]);

  const nativeSourceSize = useMemo<PixelSize | null>(() => {
    const width = sourceW > 0 ? sourceW : videoW;
    const height = sourceH > 0 ? sourceH : videoH;
    return width > 0 && height > 0 ? { width, height } : null;
  }, [sourceW, sourceH, videoW, videoH]);

  if (error) {
    return createPortal(
      <div className="embed-player show-controls">
        <div className="embed-stage" />
        <div className="embed-error" role="alert">
          <Icon name="info" size={26} className="t-warning" />
          <p>Couldn’t play this stream in the built-in player.</p>
          <p className="embed-error-detail">{error}</p>
          <div className="embed-error-actions">
            <button
              type="button"
              className="btn btn-prominent"
              onClick={() => {
                void (async () => {
                  try {
                    await openInExternalPlayer(
                      url,
                      undefined,
                      playbackAuthorization,
                    );
                    onClose(); // handed off - close the built-in player.
                  } catch (err) {
                    // The fallback failed too (no external player, not under
                    // Tauri): keep the card open and tell the user, don't
                    // silently vanish.
                    setError(
                      `No external player available either - install mpv or VLC. (${
                        err instanceof Error ? err.message : String(err)
                      })`,
                    );
                  }
                })();
              }}
            >
              Open in external player
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // This is a full-window layer, so keep it outside filtered, inset, or scrolled
  // app overlays that would otherwise become its fixed-position containing block.
  return createPortal(
    <div
      className={`embed-player${castSuspended ? " is-casting" : ""}${
        controlsVisible ||
        menu != null ||
        detailsSection != null ||
        fullscreenError != null ||
        castSuspended
          ? " show-controls"
          : ""
      }`}
      onMouseMove={nudgeControls}
    >
      {/* Transparent stage - the native mpv surface shows through. Clicking it
          (not the controls) toggles play/pause. */}
      <div
        className="embed-stage"
        onClick={castSuspended ? undefined : handleStageClick}
        onDoubleClick={castSuspended ? undefined : handleStageDoubleClick}
      />

      {buffering && !ended && !paused && (
        <div className="embed-spinner" aria-label="Buffering">
          <span />
        </div>
      )}

      {/* Up-next / replay affordance at end of file. */}
      {ended && (
        <div className="embed-endcard">
          {onPlayNext != null ? (
            <>
              <span className="embed-endcard-eyebrow">Up next</span>
              {nextLabel && <span className="embed-endcard-title">{nextLabel}</span>}
              <button type="button" className="btn btn-prominent" onClick={onPlayNext}>
                <Icon name="play" size={16} filled />
                Play next
              </button>
              <button type="button" className="btn" onClick={togglePause}>
                Replay
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-prominent" onClick={togglePause}>
              <Icon name="refresh" size={16} />
              Replay
            </button>
          )}
        </div>
      )}

      {paused && !ended && menu == null && detailsSection == null && !scrubbing && (
        <PlayerPauseOverlay
          title={title}
          nowPlaying={nowPlaying}
          onResume={togglePause}
        />
      )}

      <div className="embed-controls">
        {/* Top bar */}
        <div className="embed-top">
          <div className="embed-titles">
            <span className="embed-title" title={title}>
              {title}
            </span>
            {subtitle && <span className="embed-subtitle">{subtitle}</span>}
          </div>
          <div className="embed-top-actions">
            <button
              type="button"
              className="embed-icon-btn"
              onClick={() =>
                setDetailsSection((section) => section === "info" ? null : "info")
              }
              aria-label="Player details and shortcuts"
              aria-haspopup="dialog"
              aria-expanded={detailsSection != null}
              title="Player details and shortcuts (?)"
            >
              <Icon name="info" size={19} />
            </button>
            <button
              type="button"
              className="embed-icon-btn"
              onClick={doClose}
              aria-label="Close player"
              title="Close player (Esc)"
            >
              <Icon name="xmark" size={20} />
            </button>
          </div>
        </div>

        {detailsSection != null && (
          <PlayerInfoPopover
            engine={engine}
            sourceSize={nativeSourceSize}
            displaySize={displaySize}
            sourceFileName={sourceFileName}
            section={detailsSection}
            onSectionChange={setDetailsSection}
            shortcuts={NATIVE_SHORTCUTS}
            onClose={() => setDetailsSection(null)}
          />
        )}

        {fullscreenError && (
          <div className="embed-fullscreen-error" role="status">
            {fullscreenError}
          </div>
        )}

        {/* Bottom control bar */}
        <div className="embed-bottom">
          <NativeScrubber
            ref={scrubberRef}
            duration={dur}
            chapters={chapters}
            active={controlsVisible || menu != null || detailsSection != null}
            onSeek={seekTo}
            onScrubbingChange={setScrubbing}
          />

          {/* Buttons row: equal flexible side columns keep the transport group
              (center) centered on the frame regardless of side widths. */}
          <div className="embed-buttons">
            <div className="embed-buttons-left">
              <div
                className="embed-volume"
                onWheel={(e) => {
                  changeVolume((muted ? lastAudibleVolume.current : volume) + (e.deltaY < 0 ? 5 : -5));
                }}
              >
                <button
                  type="button"
                  className="embed-icon-btn"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  title={muted ? "Unmute (M)" : "Mute (M)"}
                >
                  <Icon name={muted || volume === 0 ? "volume-muted" : "volume"} size={20} />
                </button>
                <input
                  className="embed-vol-range"
                  type="range"
                  min={0}
                  max={130}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  title="Volume (Up / Down or scroll)"
                  style={{ ["--v" as string]: `${(muted ? 0 : volume) / 1.3}%` }}
                />
              </div>
            </div>

            <div className="embed-buttons-center">
              <button
                type="button"
                className="embed-icon-btn"
                onClick={() => relSeek(-10)}
                aria-label="Back 10 seconds"
                title="Back 10 seconds (Left)"
              >
                <Icon name="rewind" size={20} />
                <span className="embed-skip-num">10</span>
              </button>
              <button
                type="button"
                className="embed-play-btn"
                onClick={togglePause}
                aria-label={paused ? "Play" : "Pause"}
                title={paused ? "Play (Space)" : "Pause (Space)"}
              >
                {paused || ended ? (
                  <Icon name="play" size={26} filled />
                ) : (
                  <span className="embed-pause-glyph" aria-hidden>
                    <i />
                    <i />
                  </span>
                )}
              </button>
              <button
                type="button"
                className="embed-icon-btn"
                onClick={() => relSeek(10)}
                aria-label="Forward 10 seconds"
                title="Forward 10 seconds (Right)"
              >
                <Icon name="forward" size={20} />
                <span className="embed-skip-num">10</span>
              </button>
            </div>

            <div className="embed-buttons-right">
              <CastControls
                media={{ url, title, subtitleUrl: activeSubtitleUrl }}
                buttonClassName="embed-icon-btn"
                onLocalPlaybackChange={setCastSuspended}
              />
              {onPlayNext != null && (
                <button
                  type="button"
                  className="embed-next-btn"
                  onClick={onPlayNext}
                  aria-label="Next episode"
                  title={nextLabel ? `Next episode: ${nextLabel}` : "Next episode"}
                >
                  <span>Next</span>
                  <Icon name="skip-next" size={17} />
                </button>
              )}
              <MenuButton
                label="Speed"
                active={menu === "speed"}
                onClick={() => openMenu("speed")}
                badge={speed !== 1 ? `${speed}×` : undefined}
              >
                <Icon name="speed" size={18} />
              </MenuButton>
              {audioTracks.length > 0 && (
                <MenuButton
                  label="Audio"
                  active={menu === "audio"}
                  onClick={() => openMenu("audio")}
                >
                  <Icon name="audio" size={18} />
                </MenuButton>
              )}
              <MenuButton
                label="Subtitles"
                active={menu === "sub"}
                onClick={() => openMenu("sub")}
                badge={activeSid !== "no" && subTracks.length > 0 ? "CC" : undefined}
              >
                <Icon name="captions" size={18} />
              </MenuButton>
              {chapters.length > 1 && (
                <MenuButton
                  label="Chapters"
                  active={menu === "chapters"}
                  onClick={() => openMenu("chapters")}
                >
                  <Icon name="library" size={18} />
                </MenuButton>
              )}
              <MenuButton
                label="Settings"
                active={menu === "settings"}
                onClick={() => openMenu("settings")}
              >
                <Icon name="sliders" size={18} />
              </MenuButton>
              <button
                type="button"
                className="embed-icon-btn"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
              >
                <Icon name={fullscreen ? "fullscreen-exit" : "fullscreen"} size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Popover menus */}
        {menu === "speed" && (
          <Popover onClose={() => setMenu(null)} className="embed-menu-speed">
            <div className="embed-menu-title">Playback speed</div>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={"embed-menu-item" + (speed === s ? " is-active" : "")}
                role="menuitemradio"
                aria-checked={speed === s}
                onClick={() => {
                  applySpeed(s);
                  setMenu(null);
                }}
              >
                {s === 1 ? "Normal" : `${s}×`}
                {speed === s && <Icon name="check" size={14} />}
              </button>
            ))}
          </Popover>
        )}

        {menu === "audio" && (
          <Popover onClose={() => setMenu(null)}>
            <div className="embed-menu-title">Audio</div>
            {audioTracks.length === 0 && (
              <div className="embed-menu-empty">No audio tracks</div>
            )}
            {audioTracks.map((t, i) => {
              const on = activeAid === String(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={"embed-menu-item" + (on ? " is-active" : "")}
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    selectAudio(String(t.id));
                    setMenu(null);
                  }}
                >
                  {trackLabel(t, i)}
                  {on && <Icon name="check" size={14} />}
                </button>
              );
            })}
          </Popover>
        )}

        {menu === "sub" && (
          <Popover onClose={() => setMenu(null)}>
            <div className="embed-menu-title">Subtitles</div>
            <button
              type="button"
              className={"embed-menu-item" + (activeSid === "no" ? " is-active" : "")}
              role="menuitemradio"
              aria-checked={activeSid === "no"}
              onClick={() => {
                selectSub("no");
                setMenu(null);
              }}
            >
              Off
              {activeSid === "no" && <Icon name="check" size={14} />}
            </button>
            {subTracks.map((t, i) => {
              const on = activeSid === String(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={"embed-menu-item" + (on ? " is-active" : "")}
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    selectSub(String(t.id));
                    setMenu(null);
                  }}
                >
                  {trackLabel(t, i)}
                  {on && <Icon name="check" size={14} />}
                </button>
              );
            })}
          </Popover>
        )}

        {menu === "chapters" && (
          <Popover onClose={() => setMenu(null)} className="embed-menu-chapters">
            <div className="embed-menu-title">Chapters</div>
            {chapters.map((c, i) => (
              <button
                key={i}
                type="button"
                className={
                  "embed-menu-item embed-chapter-item" +
                  (activeChapterIndex === i ? " is-active" : "")
                }
                role="menuitem"
                onClick={() => jumpChapter(c.time)}
              >
                <span className="embed-chapter-name">{c.title}</span>
                <span className="embed-chapter-time">{fmt(c.time)}</span>
              </button>
            ))}
          </Popover>
        )}

        {menu === "settings" && (
          <Popover onClose={() => setMenu(null)} className="embed-menu-settings">
            <div className="embed-menu-title">Playback settings</div>
            <Slider
              label="Subtitle size"
              value={subScale}
              min={0.5}
              max={2}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={applySubScale}
            />
            <Slider
              label="Subtitle delay"
              value={subDelay}
              min={-10}
              max={10}
              step={0.1}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
              onChange={applySubDelay}
            />
            <Slider
              label="Audio delay"
              value={audioDelay}
              min={-10}
              max={10}
              step={0.1}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
              onChange={applyAudioDelay}
            />
          </Popover>
        )}
      </div>

    </div>,
    document.body,
  );
}

/** A control-bar button that opens a popover; shows an optional value badge. */
function MenuButton({
  label,
  active,
  onClick,
  badge,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"embed-icon-btn embed-menu-btn" + (active ? " is-active" : "")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
      {badge && <span className="embed-menu-badge">{badge}</span>}
    </button>
  );
}

/** A dismissible popover anchored above the control bar. */
function Popover({
  children,
  onClose,
  className,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstItem = menuRef.current?.querySelector<HTMLElement>(
      ".embed-menu-item.is-active, .embed-menu-item",
    );
    firstItem?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(".embed-menu-item"),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };

  return (
    <>
      <button
        type="button"
        className="embed-menu-scrim"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        className={"embed-menu glass-lit" + (className ? " " + className : "")}
        role="menu"
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="embed-setting">
      <span className="embed-setting-head">
        <span>{label}</span>
        <span className="embed-setting-val">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

const NATIVE_SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "Play / pause"],
  ["← / →", "Seek ∓10s"],
  ["J / L", "Seek ∓30s"],
  ["↑ / ↓", "Volume"],
  ["0 – 9", "Jump to 0–90%"],
  ["< / >", "Speed down / up"],
  ["C", "Cycle subtitles"],
  ["M", "Mute"],
  ["F", "Fullscreen"],
  ["Esc", "Back / close"],
  ["?", "This help"],
];
