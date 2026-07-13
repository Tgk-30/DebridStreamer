import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadsBridge, DownloadProgress } from "../../lib/downloadsBridge";
import type { DownloadRecord } from "../../storage/models";
import type { Store } from "../../storage/types";
import {
  DownloadManager,
  enqueueSeasonDownloads,
  type DownloadDebridResolver,
} from "./DownloadManager";

class DownloadStore {
  records = new Map<string, DownloadRecord>();
  listeners = new Set<(records: DownloadRecord[]) => void>();
  history: DownloadRecord["status"][] = [];
  updateCalls = 0;
  listCalls = 0;

  async getSetting(key: string): Promise<string | null> {
    return key === "downloads_directory" ? "/Downloads" : null;
  }
  async setSetting(): Promise<void> {}
  async saveDownload(record: DownloadRecord): Promise<void> {
    this.records.set(record.jobId, record);
    this.history.push(record.status);
    this.notify();
  }
  async updateDownload(
    jobId: string,
    changes: Partial<Omit<DownloadRecord, "jobId" | "createdAt">>,
  ): Promise<DownloadRecord | null> {
    this.updateCalls += 1;
    const current = this.records.get(jobId);
    if (current == null) return null;
    const next = { ...current, ...changes, jobId, createdAt: current.createdAt };
    this.records.set(jobId, next);
    this.history.push(next.status);
    this.notify();
    return next;
  }
  async deleteDownload(jobId: string): Promise<void> {
    this.records.delete(jobId);
    this.notify();
  }
  async listDownloads(): Promise<DownloadRecord[]> {
    this.listCalls += 1;
    return [...this.records.values()];
  }
  subscribeDownloads(listener: (records: DownloadRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.records.values()]);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    const rows = [...this.records.values()];
    this.listeners.forEach((listener) => listener(rows));
  }
}

function makeBridge() {
  let emit: ((progress: DownloadProgress) => void) | null = null;
  const bridge: DownloadsBridge = {
    downloadStart: vi.fn(async () => {}),
    downloadPause: vi.fn(async () => {}),
    downloadResume: vi.fn(async () => {}),
    downloadCancel: vi.fn(async () => {}),
    transcodeStart: vi.fn(async () => {}),
    transcodeCancel: vi.fn(async () => {}),
    downloadsFfmpegAvailable: vi.fn(async () => true),
    downloadsDefaultDir: vi.fn(async () => "/Downloads"),
    listenDownloadProgress: vi.fn(async (callback) => {
      emit = callback;
      return () => {
        emit = null;
      };
    }),
  };
  return {
    bridge,
    emit(progress: DownloadProgress) {
      emit?.(progress);
    },
  };
}

function resolver(): DownloadDebridResolver {
  return {
    resolveStream: vi.fn(async () => ({
      streamURL: "https://cdn.example/file",
      fileName: "movie.mp4",
    })),
  };
}

async function status(store: DownloadStore, jobId: string): Promise<DownloadRecord["status"]> {
  return (await store.listDownloads()).find((record) => record.jobId === jobId)!.status;
}

async function waitUntil(assertion: () => Promise<void>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

describe("DownloadManager", () => {
  const managers: DownloadManager[] = [];
  afterEach(() => {
    managers.splice(0).forEach((manager) => manager.stop());
    vi.useRealTimers();
  });

  it("moves an optimized job through queued, resolving, downloading, optimizing, and completed", async () => {
    const store = new DownloadStore();
    const native = makeBridge();
    const manager = new DownloadManager(store as unknown as Store, resolver(), {
      bridge: native.bridge,
    });
    managers.push(manager);
    await manager.start();
    const record = await manager.enqueue({
      jobId: "optimized",
      mediaId: "tmdb-1",
      title: "Movie (2024)",
      infoHash: "abc",
      mode: "optimized",
      optimizeProfile: "remux",
    });

    await waitUntil(() => expect(status(store, record.jobId)).resolves.toBe("downloading"));
    native.emit({ jobId: record.jobId, phase: "downloading", bytesDone: 20, bytesTotal: 100 });
    native.emit({ jobId: record.jobId, phase: "completed", bytesDone: 100, bytesTotal: 100 });
    await waitUntil(() => expect(status(store, record.jobId)).resolves.toBe("optimizing"));
    expect(native.bridge.transcodeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: record.jobId,
        inputPath: "/Downloads/Movie (2024)/Movie (2024).source.mp4",
        outputPath: "/Downloads/Movie (2024)/Movie (2024).mkv",
      }),
    );
    native.emit({
      jobId: record.jobId,
      phase: "completed",
      bytesDone: 100,
      bytesTotal: 100,
      outputPath: "/Downloads/Movie (2024)/Movie (2024).mkv",
    });
    await waitUntil(() => expect(status(store, record.jobId)).resolves.toBe("completed"));
    expect(store.history).toEqual(expect.arrayContaining(["queued", "resolving", "downloading", "optimizing", "completed"]));
  });

  it("persists failed, paused, resumed, and canceled states without inventing completion", async () => {
    const store = new DownloadStore();
    const native = makeBridge();
    const badResolver: DownloadDebridResolver = {
      resolveStream: vi.fn(async () => {
        throw new Error("expired link");
      }),
    };
    const failed = new DownloadManager(store as unknown as Store, badResolver, { bridge: native.bridge });
    managers.push(failed);
    await failed.start();
    const failedRecord = await failed.enqueue({ jobId: "failed", mediaId: "m", title: "Bad", infoHash: "x", mode: "full" });
    await waitUntil(() => expect(status(store, failedRecord.jobId)).resolves.toBe("failed"));

    failed.stop();
    const working = new DownloadManager(store as unknown as Store, resolver(), { bridge: native.bridge });
    managers.push(working);
    await working.start();
    const record = await working.enqueue({ jobId: "controls", mediaId: "m", title: "Good", infoHash: "y", mode: "full" });
    await waitUntil(() => expect(status(store, record.jobId)).resolves.toBe("downloading"));
    await working.pause(record.jobId);
    expect(await status(store, record.jobId)).toBe("paused");
    expect(native.bridge.downloadPause).toHaveBeenCalledWith(record.jobId);
    await working.resume(record.jobId);
    expect(await status(store, record.jobId)).toBe("downloading");
    expect(native.bridge.downloadResume).toHaveBeenCalledWith(record.jobId);
    await working.cancel(record.jobId);
    expect(await status(store, record.jobId)).toBe("canceled");
    expect(native.bridge.downloadCancel).toHaveBeenCalledWith(record.jobId);
  });

  it("recovers interrupted native phases as paused after an app restart", async () => {
    const store = new DownloadStore();
    await store.saveDownload({
      jobId: "restart",
      mediaId: "m",
      episodeId: null,
      title: "Interrupted",
      season: null,
      episode: null,
      infoHash: "hash",
      fileHint: null,
      mode: "full",
      optimizeProfile: null,
      keepAudioLangs: [],
      keepSubLangs: [],
      status: "downloading",
      bytesDone: 12,
      bytesTotal: 100,
      destPath: "/Downloads/Interrupted.mp4",
      error: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const manager = new DownloadManager(store as unknown as Store, resolver(), {
      bridge: makeBridge().bridge,
    });
    managers.push(manager);
    await manager.start();
    expect(await status(store, "restart")).toBe("paused");
  });

  it("coalesces byte persistence while keeping the live UI fed between writes", async () => {
    const store = new DownloadStore();
    const native = makeBridge();
    const manager = new DownloadManager(store as unknown as Store, resolver(), {
      bridge: native.bridge,
    });
    managers.push(manager);
    await manager.start();
    const record = await manager.enqueue({
      jobId: "rapid-progress",
      mediaId: "m",
      title: "Rapid",
      infoHash: "hash",
      mode: "full",
    });
    await waitUntil(() => expect(status(store, record.jobId)).resolves.toBe("downloading"));

    const liveProgress = vi.fn();
    manager.subscribeProgress(liveProgress);
    store.updateCalls = 0;
    store.listCalls = 0;
    vi.useFakeTimers();

    for (let bytesDone = 1; bytesDone <= 20; bytesDone += 1) {
      native.emit({ jobId: record.jobId, phase: "downloading", bytesDone, bytesTotal: 100 });
    }
    // The first value is immediate; the latest burst value is delivered at
    // 5Hz, independently of the 1Hz durable write cadence.
    expect(liveProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(liveProgress).toHaveBeenCalledTimes(2);
    expect(liveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ bytesDone: 20 }),
    );
    expect(store.updateCalls).toBe(1);
    // The queue subscription sees the persisted byte values, but because the
    // status has not changed it does not call pump() for another full-table read.
    expect(store.listCalls).toBe(0);
    expect((await store.listDownloads()).find((row) => row.jobId === record.jobId)?.bytesDone).toBe(20);

    store.listCalls = 0;
    for (let bytesDone = 21; bytesDone <= 40; bytesDone += 1) {
      native.emit({ jobId: record.jobId, phase: "downloading", bytesDone, bytesTotal: 100 });
    }
    await vi.advanceTimersByTimeAsync(799);
    expect(store.updateCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(store.updateCalls).toBe(2);
    expect(store.listCalls).toBe(0);
    expect((await store.listDownloads()).find((row) => row.jobId === record.jobId)?.bytesDone).toBe(40);
  });

  it("enqueues every supplied season episode as an independent durable record", async () => {
    const store = new DownloadStore();
    const records = await enqueueSeasonDownloads(store as unknown as Store, [
      { jobId: "s1e1", mediaId: "show", episodeId: "s1e1", title: "Show S01E01", season: 1, episode: 1, infoHash: "a", mode: "full" },
      { jobId: "s1e2", mediaId: "show", episodeId: "s1e2", title: "Show S01E02", season: 1, episode: 2, infoHash: "b", mode: "full" },
      { jobId: "s1e3", mediaId: "show", episodeId: "s1e3", title: "Show S01E03", season: 1, episode: 3, infoHash: "c", mode: "full" },
    ]);
    expect(records).toHaveLength(3);
    expect((await store.listDownloads()).map((record) => record.episodeId)).toEqual(["s1e1", "s1e2", "s1e3"]);
    expect(records.every((record) => record.status === "queued")).toBe(true);
  });
});
