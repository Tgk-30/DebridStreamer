// Drop-in replacement for `tauri-plugin-libmpv-api`, backed by our own in-window
// mpv render-API player (web/src-tauri/src/render_player.rs). Same surface the
// EmbeddedPlayer already uses: init / destroy / command / setProperty /
// getProperty / observeProperties / setVideoMarginRatio.
//
// Video renders on a native CAOpenGLLayer BEHIND the transparent webview; these
// functions just drive mpv over Tauri IPC and stream property changes back via
// the `player-event` event.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** One observed property: [name, format, fallback?] - matches the plugin shape. */
export type MpvObservableProperty = readonly [string, string, ...string[]];

export interface MpvConfig {
  initialOptions?: Record<string, string | number | boolean>;
  observedProperties?: readonly MpvObservableProperty[];
}

/** A property change pushed from mpv. */
interface PlayerEvent {
  name: string;
  data: unknown;
}

// Keep redundant geometry IPC out of resize-heavy paths. The native core owns the
// actual surface size, so only a changed margin needs to cross the bridge.
let lastVideoMarginBottom: number | undefined;
// Tauri commands are asynchronous. Serialize lifecycle transitions so a rapid
// close and reopen cannot let an older destroy tear down a newer player.
let lifecycleTail: Promise<void> = Promise.resolve();

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const queued = lifecycleTail.then(operation, operation);
  // Keep the next lifecycle operation usable even when this one fails.
  lifecycleTail = queued.then(() => undefined, () => undefined);
  return queued;
}

function stringifyOptions(
  opts: Record<string, string | number | boolean> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts ?? {})) {
    out[k] = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  }
  return out;
}

function toObserveSpecs(
  props: readonly MpvObservableProperty[] | undefined,
): Array<{ name: string; format: string }> {
  return (props ?? []).map((p) => ({ name: p[0], format: p[1] }));
}

/** Create the player (mpv + native surface + event stream). No file is loaded. */
export function init(config: MpvConfig): Promise<void> {
  return enqueueLifecycle(async () => {
    lastVideoMarginBottom = undefined;
    await invoke("player_init", {
      options: stringifyOptions(config.initialOptions),
      observed: toObserveSpecs(config.observedProperties),
    });
  });
}

/** Tear the player down and remove the native surface. */
export function destroy(): Promise<void> {
  return enqueueLifecycle(async () => {
    lastVideoMarginBottom = undefined;
    await invoke("player_destroy");
  });
}

/** Run an mpv command, e.g. command("loadfile", [url, "replace"]). */
export async function command(
  name: string,
  args: ReadonlyArray<string | number> = [],
  streamAuthorization?: string,
): Promise<void> {
  await invoke("player_command", {
    args: [name, ...args.map(String)],
    streamAuthorization,
  });
}

/** Set an mpv property. Booleans become yes/no; numbers are stringified. */
export async function setProperty(
  name: string,
  value: string | number | boolean,
): Promise<void> {
  const v =
    typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  await invoke("player_set_property", { name, value: v });
}

/**
 * Get an mpv property. `format` is accepted for API parity; only `track-list`
 * and `chapter-list` are supported, and both come back as JSON arrays.
 */
export async function getProperty(
  name: string,
  _format?: string,
): Promise<unknown> {
  return invoke("player_get_property", { name });
}

/** Attach a downloaded or translated WebVTT track to the native player. */
export async function addSubtitleTrack(
  contents: string,
  label: string,
  language: string,
): Promise<number> {
  return invoke<number>("player_add_subtitle", {
    contents,
    label,
    language,
  });
}

/** Enable or disable codec passthrough on the selected native audio device. */
export async function setAudioPassthrough(enabled: boolean): Promise<void> {
  await invoke("player_set_audio_passthrough", { enabled });
}

/** Apply an explicit native HDR output policy. */
export async function setHdrPolicy(
  policy: "auto" | "preserve" | "tone-map",
): Promise<void> {
  await invoke("player_set_hdr_policy", { policy });
}

/**
 * Register a callback for observed property changes. The properties themselves
 * are already observed by `init` (from config.observedProperties); this attaches
 * the listener and returns an unlisten function.
 */
export async function observeProperties(
  _properties: readonly MpvObservableProperty[],
  callback: (ev: { name: string; data: unknown }) => void,
): Promise<() => void> {
  const unlisten = await listen<PlayerEvent>("player-event", (e) => {
    callback({ name: e.payload.name, data: e.payload.data });
  });
  return unlisten;
}

/** Reserve a fraction of the bottom of the video for the control bar. */
export async function setVideoMarginRatio(margin: {
  bottom?: number;
}): Promise<void> {
  const bottom = margin.bottom ?? 0;
  if (lastVideoMarginBottom === bottom) return;
  lastVideoMarginBottom = bottom;
  try {
    await invoke("player_set_video_margin", { bottom });
  } catch (error) {
    // Allow a later retry when the native surface was not ready yet.
    lastVideoMarginBottom = undefined;
    throw error;
  }
}
