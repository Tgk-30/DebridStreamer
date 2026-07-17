// EmbeddedPlayer - the built-in libmpv player. Video renders on a native
// Metal/GL surface BEHIND the transparent webview; this component draws a
// premium control layer on top and drives libmpv over IPC (tauri-plugin-libmpv).
// Handles any container (MKV/HEVC/AV1) losslessly, unlike the <video> webview.
//
// Beyond a basic player: audio/subtitle track menus, playback speed, chapter
// navigation (with scrubber markers), buffered range, hover scrub preview,
// subtitle + audio sync, real fullscreen, gestures, and a full keyboard map.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlayerInfoPopover } from "./player/PlayerInfoPopover";
import "./EmbeddedPlayer.css";

interface Props {
  url: string;
  title: string;
  /** Optional secondary line (e.g. "S2 · E5 · Episode title"). */
  subtitle?: string | null;
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
 *  is the backstop; an mpv end-file ERROR event closes the common case faster. */
const FIRST_FRAME_WATCHDOG_MS = 10_000;

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
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

type MenuId = "audio" | "sub" | "speed" | "chapters" | "settings" | null;

export function EmbeddedPlayer({
  url,
  title,
  subtitle,
  startPositionSeconds = 0,
  savedPrefs,
  onProgress,
  onPlayNext,
  nextLabel,
  engine = "native-mpv",
  onPlaybackError,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [bufferedTo, setBufferedTo] = useState(0);
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
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onPlaybackErrorRef.current = onPlaybackError;
  const hideTimer = useRef<number | undefined>(undefined);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu != null || shortcutsOpen || infoOpen;

  posRef.current = pos;
  durRef.current = dur;

  const audioTracks = useMemo(() => tracks.filter((t) => t.type === "audio"), [tracks]);
  const subTracks = useMemo(() => tracks.filter((t) => t.type === "sub"), [tracks]);

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
      setChapters(parseChapters(raw));
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
                break;
              case "time-pos":
                if (typeof ev.data === "number") {
                  setPos(ev.data);
                  // First position report ≈ first frame shown → drop the
                  // initial-load spinner and stand the watchdog down.
                  if (!firstFrameRef.current) {
                    firstFrameRef.current = true;
                    setBuffering(false);
                    window.clearTimeout(watchdog);
                  }
                }
                break;
              case "duration":
                if (typeof ev.data === "number") setDur(ev.data);
                break;
              case "paused-for-cache":
                // Only a real cache stall (after playback has started) toggles the
                // spinner; before the first frame the initial spinner owns it.
                if (firstFrameRef.current) setBuffering(Boolean(ev.data));
                break;
              case "volume":
                if (typeof ev.data === "number") setVolume(Math.round(ev.data));
                break;
              case "speed":
                if (typeof ev.data === "number") setSpeed(ev.data);
                break;
              case "demuxer-cache-time":
                if (typeof ev.data === "number") setBufferedTo(ev.data);
                break;
              case "aid":
                setActiveAid(ev.data == null ? "no" : String(ev.data));
                break;
              case "sid":
                setActiveSid(ev.data == null ? "no" : String(ev.data));
                break;
              case "eof-reached":
                if (ev.data === true) setEnded(true);
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
        const opts =
          startPositionSeconds > 5
            ? `start=+${Math.floor(startPositionSeconds)}`
            : undefined;
        setEnded(false);
        await command("loadfile", opts ? [url, "replace", opts] : [url]);
        await setProperty("pause", false);
        startedRef.current = true;
        // Arm the first-frame watchdog. loadfile has been accepted, but mpv can
        // still stall forever without ever decoding a frame; if we're still
        // pre-first-frame after the window, hand off to the webview transcode.
        watchdog = window.setTimeout(() => {
          if (cancelled || firstFrameRef.current) return;
          void triggerNativeFallback(
            new Error("Native playback produced no frame in time"),
          );
        }, FIRST_FRAME_WATCHDOG_MS);
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
    };
  }, [url, startPositionSeconds, refreshTracks, refreshChapters]);

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

  // ── Throttled progress write-back (every ~5s) ─────────────────────────────
  useEffect(() => {
    if (!startedRef.current || dur <= 0) return;
    const now = Date.now();
    if (now - lastReportRef.current >= 5000) {
      lastReportRef.current = now;
      onProgress?.(pos, dur, prefsRef.current);
    }
  }, [pos, dur, onProgress]);

  // ── Auto-hide controls + cursor while playing (kept up while a menu is open)
  const nudgeControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (menuOpenRef.current || !posRef.current || durRef.current === 0) return;
      setControlsVisible(false);
    }, 3200);
  }, []);
  useEffect(() => {
    nudgeControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [nudgeControls]);

  // ── Playback controls ──────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (ended) {
      setEnded(false);
      void command("seek", [0, "absolute"]);
      void setProperty("pause", false);
      return;
    }
    void setProperty("pause", !paused);
    nudgeControls();
  }, [paused, ended, nudgeControls]);

  const seekTo = useCallback((to: number) => {
    setPos(to);
    setEnded(false);
    void command("seek", [Math.max(0, to), "absolute"]);
  }, []);

  const relSeek = useCallback(
    (delta: number) => {
      setEnded(false);
      void command("seek", [delta, "relative"]);
      nudgeControls();
    },
    [nudgeControls],
  );

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    void setProperty("volume", v);
    void setProperty("mute", v === 0);
  }, []);
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    void setProperty("mute", next);
  }, [muted]);

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

  const toggleFullscreen = useCallback(() => {
    const next = !fullscreen;
    setFullscreen(next);
    void getCurrentWindow().setFullscreen(next).catch(() => {});
  }, [fullscreen]);

  const doClose = useCallback(() => {
    if (fullscreen) void getCurrentWindow().setFullscreen(false).catch(() => {});
    if (startedRef.current && durRef.current > 0) {
      onProgress?.(posRef.current, durRef.current, prefsRef.current);
    }
    onClose();
  }, [onClose, onProgress, fullscreen]);

  // Keep the current window's real fullscreen state in sync (Esc, green button).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onResized(async () => {
        try {
          setFullscreen(await getCurrentWindow().isFullscreen());
        } catch {
          /* ignore */
        }
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

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
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePause();
          break;
        case "ArrowRight":
          e.preventDefault();
          relSeek(10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          relSeek(-10);
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
          setShortcutsOpen((o) => !o);
          break;
        case "Escape":
          if (shortcutsOpen) setShortcutsOpen(false);
          else if (infoOpen) setInfoOpen(false);
          else if (menu != null) setMenu(null);
          else if (fullscreen) toggleFullscreen();
          else doClose();
          break;
        default:
          if (/^[0-9]$/.test(e.key) && durRef.current > 0) {
            seekTo((Number(e.key) / 10) * durRef.current);
          }
      }
      nudgeControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    togglePause, relSeek, changeVolume, volume, toggleMute, toggleFullscreen,
    applySpeed, speed, doClose, seekTo, nudgeControls, menu, fullscreen,
    shortcutsOpen, infoOpen, refreshTracks,
  ]);

  // Scrub-bar pointer → time (used for both seek and hover preview).
  const timeAtClientX = useCallback(
    (clientX: number): number => {
      const el = scrubRef.current;
      if (el == null || dur <= 0) return 0;
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return frac * dur;
    },
    [dur],
  );

  const pct = (v: number) => (dur > 0 ? Math.min(100, Math.max(0, (v / dur) * 100)) : 0);
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
                    await openInExternalPlayer(url);
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
      className={`embed-player${controlsVisible || menu != null ? " show-controls" : ""}`}
      onMouseMove={nudgeControls}
      onDoubleClick={toggleFullscreen}
    >
      {/* Transparent stage - the native mpv surface shows through. Clicking it
          (not the controls) toggles play/pause. */}
      <div
        className="embed-stage"
        onClick={() => {
          if (menu != null) setMenu(null);
          else if (infoOpen) setInfoOpen(false);
          else togglePause();
        }}
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

      <div className="embed-controls">
        {/* Top bar */}
        <div className="embed-top">
          <button
            type="button"
            className="embed-icon-btn"
            onClick={doClose}
            aria-label="Close player"
          >
            <Icon name="xmark" size={22} />
          </button>
          <div className="embed-titles">
            <span className="embed-title" title={title}>
              {title}
            </span>
            {subtitle && <span className="embed-subtitle">{subtitle}</span>}
          </div>
          <button
            type="button"
            className="embed-icon-btn embed-top-help"
            onClick={() => setInfoOpen((o) => !o)}
            aria-label="Playback information"
            aria-haspopup="dialog"
            aria-expanded={infoOpen}
            title="Playback information"
          >
            <Icon name="info" size={18} />
          </button>
        </div>

        {infoOpen && (
          <PlayerInfoPopover
            engine={engine}
            sourceSize={nativeSourceSize}
            displaySize={displaySize}
            onClose={() => setInfoOpen(false)}
            onShowShortcuts={() => {
              setInfoOpen(false);
              setShortcutsOpen(true);
            }}
          />
        )}

        {/* Bottom control bar */}
        <div className="embed-bottom">
          {/* Scrubber: buffered range + played fill + chapter markers + hover */}
          <div className="embed-scrub-row">
            <span className="embed-time">{fmt(pos)}</span>
            <div
              className="embed-scrub"
              ref={scrubRef}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                seekTo(timeAtClientX(e.clientX));
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) seekTo(timeAtClientX(e.clientX));
                setHover({ x: e.clientX, t: timeAtClientX(e.clientX) });
              }}
              onPointerLeave={() => setHover(null)}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(dur)}
              aria-valuenow={Math.round(pos)}
              tabIndex={0}
            >
              <div className="embed-scrub-track">
                <div
                  className="embed-scrub-buffered"
                  style={{ width: `${pct(Math.max(bufferedTo, pos))}%` }}
                />
                <div className="embed-scrub-played" style={{ width: `${pct(pos)}%` }} />
                {chapters.length > 1 &&
                  chapters.map((c, i) => (
                    <span
                      key={i}
                      className="embed-scrub-chapter"
                      style={{ left: `${pct(c.time)}%` }}
                      title={c.title}
                    />
                  ))}
                <div className="embed-scrub-thumb" style={{ left: `${pct(pos)}%` }} />
              </div>
              {hover && (
                <div
                  className="embed-scrub-hover"
                  style={{
                    left: `${Math.min(100, Math.max(0, pct(hover.t)))}%`,
                  }}
                >
                  {fmt(hover.t)}
                </div>
              )}
            </div>
            <span className="embed-time">-{fmt(Math.max(0, dur - pos))}</span>
          </div>

          {/* Buttons row: equal flexible side columns keep the transport group
              (center) centered on the frame regardless of side widths. */}
          <div className="embed-buttons">
            <div className="embed-buttons-left">
              <div className="embed-volume">
                <button
                  type="button"
                  className="embed-icon-btn"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  <Icon name={muted || volume === 0 ? "eye" : "captions"} size={19} />
                </button>
                <input
                  className="embed-vol-range"
                  type="range"
                  min={0}
                  max={130}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
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
              >
                <Icon name="refresh" size={20} />
                <span className="embed-skip-num">10</span>
              </button>
              <button
                type="button"
                className="embed-play-btn"
                onClick={togglePause}
                aria-label={paused ? "Play" : "Pause"}
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
              >
                <Icon name="refresh" size={20} className="embed-flip" />
                <span className="embed-skip-num">10</span>
              </button>
            </div>

            <div className="embed-buttons-right">
              {onPlayNext != null && (
                <button
                  type="button"
                  className="embed-icon-btn"
                  onClick={onPlayNext}
                  aria-label="Next episode"
                  title={nextLabel ? `Next: ${nextLabel}` : "Next episode"}
                >
                  <Icon name="play" size={17} />
                  <Icon name="play" size={17} className="embed-next-2" />
                </button>
              )}
              <MenuButton
                label="Speed"
                active={menu === "speed"}
                onClick={() => openMenu("speed")}
                badge={speed !== 1 ? `${speed}×` : undefined}
              >
                <Icon name="refresh" size={18} />
              </MenuButton>
              {audioTracks.length > 0 && (
                <MenuButton
                  label="Audio"
                  active={menu === "audio"}
                  onClick={() => openMenu("audio")}
                >
                  <Icon name="captions" size={18} />
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
              >
                <Icon name={fullscreen ? "xmark" : "sparkles"} size={18} />
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
                  onClick={() => selectAudio(String(t.id))}
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
              onClick={() => selectSub("no")}
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
                  onClick={() => selectSub(String(t.id))}
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
                  (pos >= c.time &&
                  (i === chapters.length - 1 || pos < chapters[i + 1].time)
                    ? " is-active"
                    : "")
                }
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

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
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
  return (
    <>
      <button
        type="button"
        className="embed-menu-scrim"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className={"embed-menu glass-raised glass-lit" + (className ? " " + className : "")}
        role="menu"
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

const SHORTCUTS: Array<[string, string]> = [
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

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="embed-shortcuts-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="embed-shortcuts glass-raised glass-lit" role="dialog" aria-label="Keyboard shortcuts">
        <div className="embed-shortcuts-head">
          <span>Keyboard shortcuts</span>
          <button type="button" className="embed-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="xmark" size={16} />
          </button>
        </div>
        <ul className="embed-shortcuts-list">
          {SHORTCUTS.map(([keys, desc]) => (
            <li key={keys}>
              <kbd>{keys}</kbd>
              <span>{desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
