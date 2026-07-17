// DLNA casting orchestration. The native bridge owns SSDP and SOAP; this store
// owns the discover, load, poll, control, and stop lifecycle shared by both
// player renderers.

import { useSyncExternalStore } from "react";
import { getAttentionParked, subscribeAttention } from "./attention";
import {
  castControl,
  castDiscover,
  castLoad,
  castSetVolume,
  castStatus,
  type CastAction,
  type CastDevice,
  type CastStatus,
} from "./tauri";

export interface CastMedia {
  url: string;
  title: string;
  subtitleUrl?: string | null;
}

export type CastPhase =
  | "idle"
  | "discovering"
  | "selecting"
  | "loading"
  | "casting"
  | "error";

export interface CastState {
  phase: CastPhase;
  devices: CastDevice[];
  device: CastDevice | null;
  status: CastStatus | null;
  volume: number;
  error: string | null;
}

export interface CastBridge {
  discover(timeoutMs?: number): Promise<CastDevice[]>;
  load(device: CastDevice, media: CastMedia): Promise<void>;
  control(
    device: CastDevice,
    action: CastAction,
    positionSecs?: number | null,
  ): Promise<void>;
  status(device: CastDevice): Promise<CastStatus>;
  setVolume(device: CastDevice, level: number): Promise<void>;
}

type PollTimer = ReturnType<typeof setInterval>;

export interface CastPollEnvironment {
  hidden(): boolean;
  parked(): boolean;
  subscribe(listener: () => void): () => void;
  setInterval(callback: () => void, intervalMs: number): PollTimer;
  clearInterval(timer: PollTimer): void;
}

const INITIAL_STATE: CastState = {
  phase: "idle",
  devices: [],
  device: null,
  status: null,
  volume: 50,
  error: null,
};

const nativeBridge: CastBridge = {
  discover: (timeoutMs) => castDiscover(timeoutMs),
  load: (device, media) =>
    castLoad(device, media.url, media.title, media.subtitleUrl),
  control: (device, action, positionSecs) =>
    castControl(device, action, positionSecs),
  status: (device) => castStatus(device),
  setVolume: (device, level) => castSetVolume(device, level),
};

const browserEnvironment: CastPollEnvironment = {
  hidden: () => typeof document !== "undefined" && document.hidden,
  parked: getAttentionParked,
  subscribe: (listener) => {
    const removeAttention = subscribeAttention(listener);
    if (typeof document === "undefined") return removeAttention;
    document.addEventListener("visibilitychange", listener);
    return () => {
      removeAttention();
      document.removeEventListener("visibilitychange", listener);
    };
  },
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A finite casting state machine with an attention-aware status poller. */
export class CastController {
  private state: CastState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly removeEnvironmentListener: () => void;
  private pollTimer: PollTimer | null = null;
  private pollInFlight = false;
  private generation = 0;

  constructor(
    private readonly bridge: CastBridge = nativeBridge,
    private readonly environment: CastPollEnvironment = browserEnvironment,
    private readonly pollIntervalMs = 2_000,
  ) {
    this.removeEnvironmentListener = environment.subscribe(() =>
      this.syncPolling(),
    );
  }

  getSnapshot = (): CastState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.clearPolling();
    this.removeEnvironmentListener();
    this.listeners.clear();
  }

  async discover(timeoutMs = 2_500): Promise<void> {
    const generation = ++this.generation;
    this.update({
      phase: "discovering",
      devices: [],
      device: null,
      status: null,
      error: null,
    });
    try {
      const devices = await this.bridge.discover(timeoutMs);
      if (generation !== this.generation) return;
      this.update({ phase: "selecting", devices, error: null });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ phase: "error", error: errorMessage(error) });
    }
  }

  async load(device: CastDevice, media: CastMedia): Promise<void> {
    const generation = ++this.generation;
    this.update({
      phase: "loading",
      device,
      status: null,
      error: null,
    });
    try {
      await this.bridge.load(device, media);
      if (generation !== this.generation) return;
      this.update({
        phase: "casting",
        status: {
          state: "PLAYING",
          positionSecs: 0,
          durationSecs: 0,
        },
        error: null,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ phase: "error", error: errorMessage(error) });
    }
  }

  dismissPicker(): void {
    if (this.state.phase === "loading" || this.state.phase === "casting") return;
    this.generation += 1;
    this.update(INITIAL_STATE);
  }

  async control(
    action: Exclude<CastAction, "stop">,
    positionSecs?: number,
  ): Promise<void> {
    const device = this.state.device;
    if (device == null || this.state.phase !== "casting") return;
    if (action === "play" || action === "pause") {
      this.update({
        status: {
          state: action === "play" ? "PLAYING" : "PAUSED_PLAYBACK",
          positionSecs: this.state.status?.positionSecs ?? 0,
          durationSecs: this.state.status?.durationSecs ?? 0,
        },
        error: null,
      });
    } else if (action === "seek" && positionSecs != null) {
      this.update({
        status: {
          state: this.state.status?.state ?? "PLAYING",
          positionSecs,
          durationSecs: this.state.status?.durationSecs ?? 0,
        },
        error: null,
      });
    }
    try {
      await this.bridge.control(device, action, positionSecs);
    } catch (error) {
      if (this.state.phase === "casting" && this.state.device?.id === device.id) {
        this.update({ error: errorMessage(error) });
      }
    }
  }

  async setVolume(level: number): Promise<void> {
    const device = this.state.device;
    if (device == null || this.state.phase !== "casting") return;
    const normalized = Math.max(0, Math.min(100, Math.round(level)));
    this.update({ volume: normalized, error: null });
    try {
      await this.bridge.setVolume(device, normalized);
    } catch (error) {
      if (this.state.phase === "casting" && this.state.device?.id === device.id) {
        this.update({ error: errorMessage(error) });
      }
    }
  }

  async stop(): Promise<void> {
    const device = this.state.device;
    this.generation += 1;
    this.update(INITIAL_STATE);
    if (device == null) return;
    try {
      await this.bridge.control(device, "stop");
    } catch {
      // Stop is deliberately fire-and-forget from the UI. Local playback must
      // still be restored even when a renderer disappears from the network.
    }
  }

  private update(next: Partial<CastState> | CastState): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
    this.syncPolling();
  }

  private syncPolling(): void {
    const shouldPoll =
      this.state.phase === "casting" &&
      this.state.device != null &&
      !this.environment.hidden() &&
      !this.environment.parked();
    if (!shouldPoll) {
      this.clearPolling();
      return;
    }
    if (this.pollTimer != null) return;
    void this.pollStatus();
    this.pollTimer = this.environment.setInterval(
      () => void this.pollStatus(),
      this.pollIntervalMs,
    );
  }

  private clearPolling(): void {
    if (this.pollTimer == null) return;
    this.environment.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollStatus(): Promise<void> {
    const device = this.state.device;
    const generation = this.generation;
    if (
      this.pollInFlight ||
      device == null ||
      this.state.phase !== "casting" ||
      this.environment.hidden() ||
      this.environment.parked()
    ) {
      return;
    }
    this.pollInFlight = true;
    try {
      const status = await this.bridge.status(device);
      if (
        generation === this.generation &&
        this.state.phase === "casting" &&
        this.state.device?.id === device.id
      ) {
        this.update({ status, error: null });
      }
    } catch (error) {
      if (
        generation === this.generation &&
        this.state.phase === "casting" &&
        this.state.device?.id === device.id
      ) {
        this.update({ error: errorMessage(error) });
      }
    } finally {
      this.pollInFlight = false;
    }
  }
}

export const castController = new CastController();

export function useCastState(): CastState {
  return useSyncExternalStore(
    castController.subscribe,
    castController.getSnapshot,
    castController.getSnapshot,
  );
}
