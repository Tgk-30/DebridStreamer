// Native-download seam. Keep every Tauri-specific call in this tiny adapter so
// browser tests can replace one object without loading a Tauri runtime.

import * as tauri from "./tauri";

export interface DownloadStartArgs {
  jobId: string;
  url: string;
  headers?: Record<string, string>;
  destPath: string;
  resumeFromExisting?: boolean;
  /** Reserve room for the post-download optimized output as well as the source. */
  reserveOutputCopy?: boolean;
}

export interface TranscodeStartArgs {
  jobId: string;
  inputPath: string;
  outputPath: string;
  keepAudioLangs: string[];
  keepSubLangs: string[];
  profile: "remux" | "h265";
}

export interface DownloadProgress {
  jobId: string;
  phase: "downloading" | "optimizing" | "completed" | "failed" | "canceled";
  bytesDone: number;
  bytesTotal: number | null;
  /** Transcode progress, 0-100. Present ONLY on optimizing/transcode events;
   *  those carry no meaningful byte counters, so the record keeps the ones the
   *  download phase established. */
  percent?: number;
  speedBps?: number;
  error?: string;
  outputPath?: string;
}

export type DownloadProgressUnlisten = () => void;

/** The complete import surface the UI expects the engine to add to tauri.ts. */
export interface DownloadsBridge {
  downloadStart(args: DownloadStartArgs): Promise<void>;
  downloadPause(jobId: string): Promise<void>;
  downloadResume(jobId: string): Promise<void>;
  downloadCancel(jobId: string): Promise<void>;
  downloadForceStop(jobId: string): Promise<void>;
  transcodeStart(args: TranscodeStartArgs): Promise<void>;
  transcodeCancel(jobId: string): Promise<void>;
  downloadsFfmpegAvailable(): Promise<boolean>;
  downloadsDefaultDir(): Promise<string>;
  downloadsAvailableSpace?(path: string): Promise<number>;
  downloadDeleteFile?(path: string): Promise<void>;
  listenDownloadProgress(
    callback: (progress: DownloadProgress) => void,
  ): Promise<DownloadProgressUnlisten>;
}

// The engine adds these functions to tauri.ts in its own worktree. A namespace
// import deliberately keeps this frontend work typecheckable before that lands.
const tauriDownloads = tauri as unknown as DownloadsBridge;

const nativeDownloadsBridge: DownloadsBridge = {
  downloadStart: (args) => tauriDownloads.downloadStart(args),
  downloadPause: (jobId) => tauriDownloads.downloadPause(jobId),
  downloadResume: (jobId) => tauriDownloads.downloadResume(jobId),
  downloadCancel: (jobId) => tauriDownloads.downloadCancel(jobId),
  downloadForceStop: (jobId) => tauriDownloads.downloadForceStop(jobId),
  transcodeStart: (args) => tauriDownloads.transcodeStart(args),
  transcodeCancel: (jobId) => tauriDownloads.transcodeCancel(jobId),
  downloadsFfmpegAvailable: () => tauriDownloads.downloadsFfmpegAvailable(),
  downloadsDefaultDir: () => tauriDownloads.downloadsDefaultDir(),
  downloadsAvailableSpace: (path) => tauriDownloads.downloadsAvailableSpace!(path),
  downloadDeleteFile: (path) => tauriDownloads.downloadDeleteFile!(path),
  listenDownloadProgress: (callback) => tauriDownloads.listenDownloadProgress(callback),
};

let activeBridge: DownloadsBridge = nativeDownloadsBridge;

/** Return the current bridge. Tests can replace it without mocking Tauri. */
export function getDownloadsBridge(): DownloadsBridge {
  return activeBridge;
}

/** Test-only injection seam. Pass null to restore native bindings. */
export function __setDownloadsBridgeForTesting(bridge: DownloadsBridge | null): void {
  activeBridge = bridge ?? nativeDownloadsBridge;
}
