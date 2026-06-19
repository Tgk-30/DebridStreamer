// Per-session HLS transcode job registry + lifecycle (Phase 3b).
//
// One ffmpeg process per stream session, producing a single 720p H.264/AAC VOD
// HLS rendition into a per-session temp dir under the data dir. The registry owns
// the process + temp-dir lifecycle so there are no zombie ffmpegs or orphaned
// dirs: a boot sweep cleans crash leftovers, an idle/expiry reaper kills
// abandoned jobs, and stop() (wired to the app's onClose) tears everything down.
//
// Only constructed/started when transcoding is active (operator flag on AND
// ffmpeg present) — so it has zero cost in the default (off) configuration.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";
import type { Transcoder } from "./transcode.js";

export const MANIFEST_NAME = "stream.m3u8";
const FIRST_SEGMENT = "seg_00000.ts";
const IDLE_MS = 120_000;
const REAP_INTERVAL_MS = 30_000;
const KILL_GRACE_MS = 3000;

/** The ffmpeg argv for a single 720p H.264/AAC VOD HLS rendition into `dir`.
 *  Pure + exported so the test FakeTranscoder can derive the output dir. VOD
 *  (not a sliding window) so the whole timeline is seekable; the dir is bounded
 *  by the transcoded file and cleaned on teardown. */
export function hlsArgs(upstreamUrl: string, dir: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    upstreamUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=-2:720",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-profile:v",
    "main",
    "-level",
    "4.0",
    "-g",
    "48",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    join(dir, "seg_%05d.ts"),
    join(dir, MANIFEST_NAME),
  ];
}

interface Job {
  child: ChildProcess;
  dir: string;
  lastAccess: number;
}

export class TranscodeRegistry {
  private readonly jobs = new Map<string, Job>();
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly config: ServerConfig,
    private readonly transcoder: Transcoder,
  ) {}

  /** Boot sweep (rm temp dirs left by a previous crash) + start the idle/expiry
   *  reaper. Only called when transcoding is active. */
  start(): void {
    const rows = this.db.sqlite
      .prepare("SELECT transcode_dir FROM stream_sessions WHERE transcode_dir IS NOT NULL")
      .all() as Array<{ transcode_dir: string | null }>;
    for (const r of rows) {
      if (r.transcode_dir != null) {
        void rm(r.transcode_dir, { recursive: true, force: true }).catch(() => {});
      }
    }
    this.db.sqlite.prepare("UPDATE stream_sessions SET transcode_dir = NULL").run();
    this.reaper = setInterval(() => this.reap(), REAP_INTERVAL_MS);
    this.reaper.unref?.();
  }

  async stop(): Promise<void> {
    if (this.reaper != null) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
    await Promise.all([...this.jobs.keys()].map((id) => this.kill(id)));
  }

  /** Kill jobs whose session is gone/revoked/expired, or idle (client left). */
  private reap(): void {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    for (const [id, job] of [...this.jobs.entries()]) {
      const row = this.db.sqlite
        .prepare("SELECT revoked_at, expires_at FROM stream_sessions WHERE id = ?")
        .get(id) as { revoked_at: string | null; expires_at: string | null } | undefined;
      const dead =
        row == null ||
        row.revoked_at != null ||
        (row.expires_at != null && row.expires_at <= nowIso) ||
        now - job.lastAccess > IDLE_MS;
      if (dead) void this.kill(id);
    }
  }

  async kill(sessionId: string): Promise<void> {
    const job = this.jobs.get(sessionId);
    if (job == null) return;
    this.jobs.delete(sessionId);
    try {
      job.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const force = setTimeout(() => {
      try {
        job.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, KILL_GRACE_MS);
    force.unref?.();
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
    try {
      this.db.sqlite.prepare("UPDATE stream_sessions SET transcode_dir = NULL WHERE id = ?").run(sessionId);
    } catch {
      /* db may be closing */
    }
  }

  /** The output dir for a live job (touches lastAccess), or null. */
  dirFor(sessionId: string): string | null {
    const job = this.jobs.get(sessionId);
    if (job == null) return null;
    job.lastAccess = Date.now();
    return job.dir;
  }

  /** Ensure an HLS job exists for this session and return its output dir once the
   *  manifest + first segment are available. Reuses a live job; otherwise spawns
   *  one (subject to the concurrency cap). */
  async ensureJob(sessionId: string, upstreamUrl: string): Promise<string> {
    const existing = this.jobs.get(sessionId);
    if (existing != null) {
      existing.lastAccess = Date.now();
      return existing.dir;
    }
    if (this.jobs.size >= this.config.maxTranscodes) {
      throw Object.assign(new Error("The transcoder is busy. Try again shortly."), { statusCode: 503 });
    }

    await mkdir(this.config.dataDir, { recursive: true });
    const dir = await mkdtemp(join(this.config.dataDir, "transcode-"));
    let child: ChildProcess;
    try {
      child = this.transcoder.spawnHls(hlsArgs(upstreamUrl, dir));
    } catch (err) {
      // spawn threw synchronously (e.g. fd/memory exhaustion) BEFORE the job was
      // registered — rm the orphaned dir now (the boot sweep only knows about
      // dirs recorded on a session row, so it could never reclaim this one).
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const job: Job = { child, dir, lastAccess: Date.now() };
    this.jobs.set(sessionId, job);
    this.db.sqlite.prepare("UPDATE stream_sessions SET transcode_dir = ? WHERE id = ?").run(dir, sessionId);
    // Prevent an unhandled 'error' event (e.g. ffmpeg failed to spawn) from
    // crashing the process; teardown is driven by kill()/reaper.
    child.once("error", () => {});

    const manifest = join(dir, MANIFEST_NAME);
    const firstSeg = join(dir, FIRST_SEGMENT);
    const deadline = Date.now() + this.config.transcodeStartTimeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(manifest) && existsSync(firstSeg)) return dir;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.kill(sessionId);
    throw Object.assign(new Error("The transcode did not start in time."), { statusCode: 504 });
  }
}
