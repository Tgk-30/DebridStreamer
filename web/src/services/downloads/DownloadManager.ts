import type { EpisodeFileHint, StreamInfo } from "../debrid/models";
import {
  getDownloadsBridge,
  type DownloadProgress,
  type DownloadsBridge,
} from "../../lib/downloadsBridge";
import type { DownloadRecord } from "../../storage/models";
import type { Store } from "../../storage/types";
import {
  optimizedOutputPath,
  rawDownloadPath,
} from "./filename";

/** Plain setting key on purpose: downloads do not need a global AppSettings
 * rebuild just to change their destination. */
export const DOWNLOADS_DIRECTORY_SETTING = "downloads_directory";

export interface DownloadDebridResolver {
  resolveStream(
    infoHash: string,
    cachedOn?: null,
    fileHint?: EpisodeFileHint | null,
  ): Promise<Pick<StreamInfo, "streamURL" | "fileName">>;
}

export interface EnqueueDownloadInput {
  jobId?: string;
  mediaId: string;
  episodeId?: string | null;
  title: string;
  season?: number | null;
  episode?: number | null;
  infoHash: string;
  fileHint?: string | null;
  mode: "full" | "optimized";
  optimizeProfile?: "remux" | "h265" | null;
  keepAudioLangs?: string[];
  keepSubLangs?: string[];
}

function makeJobId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Create a complete, durable queue record from a Detail action. */
export function makeDownloadRecord(
  input: EnqueueDownloadInput,
  now = new Date().toISOString(),
): DownloadRecord {
  return {
    jobId: input.jobId ?? makeJobId(),
    mediaId: input.mediaId,
    episodeId: input.episodeId ?? null,
    title: input.title,
    season: input.season ?? null,
    episode: input.episode ?? null,
    infoHash: input.infoHash,
    fileHint: input.fileHint ?? null,
    mode: input.mode,
    optimizeProfile: input.mode === "optimized" ? input.optimizeProfile ?? "remux" : null,
    keepAudioLangs: input.keepAudioLangs ?? [],
    keepSubLangs: input.keepSubLangs ?? [],
    status: "queued",
    bytesDone: 0,
    bytesTotal: null,
    destPath: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function enqueueDownload(
  store: Store,
  input: EnqueueDownloadInput,
): Promise<DownloadRecord> {
  const record = makeDownloadRecord(input);
  await store.saveDownload(record);
  return record;
}

/** Enqueue a season or show without serially waiting for each IndexedDB write. */
export async function enqueueSeasonDownloads(
  store: Store,
  inputs: EnqueueDownloadInput[],
): Promise<DownloadRecord[]> {
  const records = inputs.map((input) => makeDownloadRecord(input));
  await Promise.all(records.map((record) => store.saveDownload(record)));
  return records;
}

export async function downloadsDirectory(
  store: Pick<Store, "getSetting" | "setSetting">,
  bridge: Pick<DownloadsBridge, "downloadsDefaultDir"> = getDownloadsBridge(),
): Promise<string> {
  const saved = await store.getSetting(DOWNLOADS_DIRECTORY_SETTING);
  if (saved != null && saved.trim().length > 0) return saved.trim();
  const defaultDir = await bridge.downloadsDefaultDir();
  await store.setSetting(DOWNLOADS_DIRECTORY_SETTING, defaultDir);
  return defaultDir;
}

type ProgressListener = (progress: DownloadProgress) => void;

/**
 * Frontend queue scheduler for the native streaming executor.
 *
 * A job starts in queued, resolves a fresh debrid URL, then waits for native
 * progress. Optimized jobs turn the native download terminal event into a
 * second optimizing phase and only complete after ffmpeg emits its terminal
 * event. Paused and terminal records never enter the scheduler automatically.
 */
export class DownloadManager {
  private readonly bridge: DownloadsBridge;
  private readonly concurrency: number;
  private started = false;
  private pumping = false;
  private progressUnlisten: (() => void) | null = null;
  private queueUnlisten: (() => void) | null = null;
  private readonly launching = new Set<string>();
  private readonly nativeJobs = new Set<string>();
  private readonly optimizingOutputs = new Map<string, string>();
  private readonly speeds = new Map<string, number>();
  private readonly progressListeners = new Set<ProgressListener>();
  private ffmpegAvailability: Promise<boolean> | null = null;

  constructor(
    private readonly store: Store,
    private readonly debrid: DownloadDebridResolver | null,
    options: { bridge?: DownloadsBridge; concurrency?: number } = {},
  ) {
    this.bridge = options.bridge ?? getDownloadsBridge();
    this.concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 3));
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.recoverInterrupted();
    this.queueUnlisten = this.store.subscribeDownloads(() => {
      void this.pump();
    });
    try {
      this.progressUnlisten = await this.bridge.listenDownloadProgress((progress) => {
        if (progress.speedBps != null) this.speeds.set(progress.jobId, progress.speedBps);
        this.progressListeners.forEach((listener) => listener(progress));
        void this.handleProgress(progress);
      });
    } catch {
      // The scheduler can still expose queued work. A later screen mount or
      // app restart will reattach native progress instead of faking success.
      this.progressUnlisten = null;
    }
    void this.pump();
  }

  stop(): void {
    this.progressUnlisten?.();
    this.progressUnlisten = null;
    this.queueUnlisten?.();
    this.queueUnlisten = null;
    this.started = false;
  }

  subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  speedFor(jobId: string): number | undefined {
    return this.speeds.get(jobId);
  }

  async enqueue(input: EnqueueDownloadInput): Promise<DownloadRecord> {
    const record = await enqueueDownload(this.store, input);
    void this.pump();
    return record;
  }

  async enqueueSeason(inputs: EnqueueDownloadInput[]): Promise<DownloadRecord[]> {
    const records = await enqueueSeasonDownloads(this.store, inputs);
    void this.pump();
    return records;
  }

  async pause(jobId: string): Promise<void> {
    const record = (await this.store.listDownloads()).find((row) => row.jobId === jobId);
    if (record == null || !["resolving", "downloading", "optimizing"].includes(record.status)) {
      return;
    }
    if (record.status === "optimizing") await this.bridge.transcodeCancel(jobId);
    else if (record.status === "downloading") await this.bridge.downloadPause(jobId);
    await this.store.updateDownload(jobId, { status: "paused", error: null });
    void this.pump();
  }

  async resume(jobId: string): Promise<void> {
    const record = (await this.store.listDownloads()).find((row) => row.jobId === jobId);
    if (record == null || record.status !== "paused") return;
    // A job paused during this process can use native HTTP Range resume. After
    // a restart the Rust process has no URL/job state, so queue a fresh resolve.
    if (this.nativeJobs.has(jobId)) {
      await this.bridge.downloadResume(jobId);
      await this.store.updateDownload(jobId, { status: "downloading", error: null });
      return;
    }
    await this.store.updateDownload(jobId, { status: "queued", error: null });
    void this.pump();
  }

  async cancel(jobId: string): Promise<void> {
    const record = (await this.store.listDownloads()).find((row) => row.jobId === jobId);
    if (record == null || ["completed", "canceled"].includes(record.status)) return;
    if (record.status === "optimizing") await this.bridge.transcodeCancel(jobId);
    else if (record.status === "downloading" || this.nativeJobs.has(jobId)) {
      await this.bridge.downloadCancel(jobId);
    }
    this.nativeJobs.delete(jobId);
    this.optimizingOutputs.delete(jobId);
    await this.store.updateDownload(jobId, { status: "canceled", error: null });
    void this.pump();
  }

  async recoverInterrupted(): Promise<void> {
    const records = await this.store.listDownloads();
    await Promise.all(
      records
        .filter((record) => record.status === "downloading" || record.status === "optimizing")
        .map((record) => this.store.updateDownload(record.jobId, { status: "paused" })),
    );
  }

  private async pump(): Promise<void> {
    if (!this.started || this.pumping) return;
    this.pumping = true;
    try {
      const records = await this.store.listDownloads();
      let active = records.filter((record) =>
        ["resolving", "downloading", "optimizing"].includes(record.status),
      ).length;
      for (const record of records.filter((row) => row.status === "queued")) {
        if (active >= this.concurrency) break;
        this.launching.add(record.jobId);
        active += 1;
        void this.resolveAndStart(record).finally(() => {
          this.launching.delete(record.jobId);
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async resolveAndStart(record: DownloadRecord): Promise<void> {
    if (this.debrid == null) {
      await this.fail(record.jobId, "Configure a debrid service before downloading.");
      return;
    }
    try {
      await this.store.updateDownload(record.jobId, {
        status: "resolving",
        error: null,
      });
      const hint: EpisodeFileHint | null =
        record.season != null && record.episode != null
          ? { season: record.season, episode: record.episode }
          : null;
      const stream = await this.debrid.resolveStream(record.infoHash, null, hint);
      const latest = (await this.store.listDownloads()).find((row) => row.jobId === record.jobId);
      if (latest == null || latest.status !== "resolving") return;
      const directory = await downloadsDirectory(this.store, this.bridge);
      const destPath = rawDownloadPath(directory, latest, stream.fileName);
      await this.store.updateDownload(record.jobId, {
        status: "downloading",
        destPath,
        bytesDone: 0,
        bytesTotal: null,
        error: null,
      });
      this.nativeJobs.add(record.jobId);
      await this.bridge.downloadStart({
        jobId: record.jobId,
        url: stream.streamURL,
        destPath,
      });
    } catch (error) {
      const latest = (await this.store.listDownloads()).find((row) => row.jobId === record.jobId);
      if (latest?.status !== "canceled" && latest?.status !== "paused") {
        await this.fail(record.jobId, errorMessage(error));
      }
    }
  }

  private async handleProgress(progress: DownloadProgress): Promise<void> {
    const record = (await this.store.listDownloads()).find((row) => row.jobId === progress.jobId);
    if (record == null) return;
    if (["paused", "canceled", "completed", "failed"].includes(record.status)) return;
    const measurements = {
      bytesDone: Math.max(0, progress.bytesDone),
      bytesTotal: progress.bytesTotal,
    };
    switch (progress.phase) {
      case "downloading":
        await this.store.updateDownload(record.jobId, { status: "downloading", ...measurements });
        return;
      case "optimizing":
        await this.store.updateDownload(record.jobId, { status: "optimizing", ...measurements });
        return;
      case "failed":
        await this.fail(record.jobId, progress.error ?? "The native download failed.");
        return;
      case "canceled":
        this.nativeJobs.delete(record.jobId);
        this.optimizingOutputs.delete(record.jobId);
        await this.store.updateDownload(record.jobId, { status: "canceled", ...measurements });
        void this.pump();
        return;
      case "completed":
        await this.completeNativePhase(record, progress, measurements);
    }
  }

  private async completeNativePhase(
    record: DownloadRecord,
    progress: DownloadProgress,
    measurements: Pick<DownloadRecord, "bytesDone" | "bytesTotal">,
  ): Promise<void> {
    if (record.status === "optimizing") {
      const finalPath = progress.outputPath ?? this.optimizingOutputs.get(record.jobId) ?? record.destPath;
      this.nativeJobs.delete(record.jobId);
      this.optimizingOutputs.delete(record.jobId);
      await this.store.updateDownload(record.jobId, {
        status: "completed",
        destPath: finalPath,
        ...measurements,
        error: null,
      });
      void this.pump();
      return;
    }

    const rawPath = progress.outputPath ?? record.destPath;
    if (record.mode === "full") {
      this.nativeJobs.delete(record.jobId);
      await this.store.updateDownload(record.jobId, {
        status: "completed",
        destPath: rawPath,
        ...measurements,
        error: null,
      });
      void this.pump();
      return;
    }

    if (rawPath == null || record.optimizeProfile == null) {
      await this.fail(record.jobId, "The downloaded source path is unavailable for optimization.");
      return;
    }
    if (!(await this.isFfmpegAvailable())) {
      await this.fail(record.jobId, "FFmpeg is unavailable, so this optimized download cannot run.");
      return;
    }
    const outputPath = optimizedOutputPath(rawPath, record.optimizeProfile);
    this.optimizingOutputs.set(record.jobId, outputPath);
    try {
      await this.store.updateDownload(record.jobId, {
        status: "optimizing",
        destPath: rawPath,
        ...measurements,
        error: null,
      });
      await this.bridge.transcodeStart({
        jobId: record.jobId,
        inputPath: rawPath,
        outputPath,
        keepAudioLangs: record.keepAudioLangs,
        keepSubLangs: record.keepSubLangs,
        profile: record.optimizeProfile,
      });
    } catch (error) {
      await this.fail(record.jobId, errorMessage(error));
    }
  }

  private async isFfmpegAvailable(): Promise<boolean> {
    this.ffmpegAvailability ??= this.bridge.downloadsFfmpegAvailable().catch(() => false);
    return this.ffmpegAvailability;
  }

  private async fail(jobId: string, error: string): Promise<void> {
    this.nativeJobs.delete(jobId);
    this.optimizingOutputs.delete(jobId);
    await this.store.updateDownload(jobId, { status: "failed", error });
    void this.pump();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
