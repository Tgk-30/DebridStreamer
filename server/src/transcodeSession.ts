// Per-session HLS transcode job registry + lifecycle (Phase 3b).
//
// One ffmpeg process per stream session, producing a bounded H.264/AAC VOD HLS
// ladder into a per-session temp dir under the data dir. The registry owns
// the process + temp-dir lifecycle so there are no zombie ffmpegs or orphaned
// dirs: a boot sweep cleans crash leftovers, an idle/expiry reaper kills
// abandoned jobs, and stop() (wired to the app's onClose) tears everything down.
//
// Only constructed/started when transcoding is active (operator flag on AND
// ffmpeg present) - so it has zero cost in the default (off) configuration.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";
import type {
  Transcoder,
  TranscodeVideoEncoder,
} from "./transcode.js";

export const MANIFEST_NAME = "stream.m3u8";
const FIRST_SEGMENT = "seg_00000.ts";
const FIRST_ADAPTIVE_SEGMENT = "1080p_seg_00000.ts";
const IDLE_MS = 120_000;
const REAP_INTERVAL_MS = 30_000;
const KILL_GRACE_MS = 3000;

export type TranscodeClientProfile = "adaptive" | "high" | "data-saver";
export type TranscodeHdrPolicy = "auto" | "preserve" | "tone-map";
export interface HlsTranscodeOptions {
  profile?: TranscodeClientProfile;
  startSeconds?: number;
  hdrPolicy?: TranscodeHdrPolicy;
  /** Preserve the first embedded subtitle track as a WebVTT sidecar. */
  preserveSubtitles?: boolean;
  videoEncoder?: TranscodeVideoEncoder;
  /** Internal result of the source probe. Defaults true for injected test
   * transcoders and backwards-compatible custom implementations. */
  includeAudio?: boolean;
  /** Internal stream-table probe result. */
  includeSubtitle?: boolean;
}

function encoderArgs(
  encoder: TranscodeVideoEncoder,
  bitrates: readonly string[],
): string[] {
  const result: string[] = [];
  for (let index = 0; index < bitrates.length; index += 1) {
    const bitrate = bitrates[index]!;
    result.push(`-c:v:${index}`, encoder);
    if (encoder === "libx264") {
      result.push(`-preset:v:${index}`, "veryfast", `-crf:v:${index}`, "25");
    } else if (encoder === "h264_nvenc") {
      result.push(`-preset:v:${index}`, "p4", `-cq:v:${index}`, "27");
    } else if (encoder === "h264_qsv") {
      result.push(`-global_quality:v:${index}`, "27");
    }
    result.push(
      `-b:v:${index}`,
      bitrate,
      `-maxrate:v:${index}`,
      bitrate,
      `-bufsize:v:${index}`,
      `${Number.parseInt(bitrate, 10) * 2}k`,
      `-pix_fmt:v:${index}`,
      "yuv420p",
      `-profile:v:${index}`,
      "main",
    );
  }
  return result;
}

function toneMapPrefix(policy: TranscodeHdrPolicy): string {
  if (policy !== "tone-map") return "";
  return "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,";
}

/** Build a seek-aware HLS transcode. Adaptive clients get 1080p, 720p, and
 *  480p renditions; high and data-saver clients get one bounded rendition.
 *  The source is never upscaled. */
export function hlsArgs(
  upstreamUrl: string,
  dir: string,
  options: HlsTranscodeOptions = {},
): string[] {
  const profile = options.profile ?? "adaptive";
  const startSeconds =
    options.startSeconds != null &&
    Number.isFinite(options.startSeconds) &&
    options.startSeconds > 0
      ? Math.min(86_400, Math.floor(options.startSeconds))
      : 0;
  const hdrPolicy = options.hdrPolicy ?? "auto";
  const encoder = options.videoEncoder ?? "libx264";
  const includeAudio = options.includeAudio !== false;
  const args = [
    "-nostdin",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
  ];
  if (startSeconds > 0) args.push("-ss", String(startSeconds));
  args.push(
    "-i",
    upstreamUrl,
  );

  if (profile === "adaptive") {
    const prefix = toneMapPrefix(hdrPolicy);
    args.push(
      "-filter_complex",
      `[0:v:0]split=3[v1080i][v720i][v480i];[v1080i]${prefix}scale=w=-2:h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2[v1080];[v720i]${prefix}scale=w=-2:h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2[v720];[v480i]${prefix}scale=w=-2:h='min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2[v480]`,
      "-map",
      "[v1080]",
      "-map",
      "[v720]",
      "-map",
      "[v480]",
      ...(includeAudio
        ? [
            "-map",
            "0:a:0",
            "-map",
            "0:a:0",
            "-map",
            "0:a:0",
          ]
        : []),
      ...encoderArgs(encoder, ["8000k", "4500k", "1800k"]),
      ...(includeAudio
        ? [
            "-c:a",
            "aac",
            "-b:a:0",
            "192k",
            "-b:a:1",
            "160k",
            "-b:a:2",
            "128k",
            "-ac",
            "2",
          ]
        : []),
      "-g",
      "144",
      "-keyint_min",
      "144",
      "-sc_threshold",
      "0",
      "-force_key_frames",
      "expr:gte(t,n_forced*6)",
      "-sn",
      "-dn",
      "-max_muxing_queue_size",
      "1024",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",
      "-hls_list_size",
      "0",
      "-master_pl_name",
      MANIFEST_NAME,
      "-var_stream_map",
      includeAudio
        ? "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p"
        : "v:0,name:1080p v:1,name:720p v:2,name:480p",
      "-hls_segment_filename",
      join(dir, "%v_seg_%05d.ts"),
      join(dir, "%v.m3u8"),
    );
  } else {
    const height = profile === "high" ? 1080 : 480;
    const videoFilter =
      `${toneMapPrefix(hdrPolicy)}scale=w=-2:h='min(${height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    args.push(
      "-map",
      "0:v:0",
      ...(includeAudio ? ["-map", "0:a:0"] : []),
      "-vf",
      videoFilter,
      ...encoderArgs(encoder, [profile === "high" ? "8000k" : "1800k"]),
      ...(includeAudio
        ? [
            "-c:a",
            "aac",
            "-b:a",
            profile === "high" ? "192k" : "96k",
            "-ac",
            "2",
          ]
        : []),
      "-g",
      "144",
      "-keyint_min",
      "144",
      "-sc_threshold",
      "0",
      "-force_key_frames",
      "expr:gte(t,n_forced*6)",
      "-sn",
      "-dn",
      "-max_muxing_queue_size",
      "1024",
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
    );
  }
  if (options.preserveSubtitles && options.includeSubtitle) {
    args.push(
      "-map",
      "0:s:0",
      "-c:s",
      "webvtt",
      "-f",
      "webvtt",
      join(dir, "subtitles.vtt"),
    );
  }
  return args;
}

interface Job {
  children: ChildProcess[];
  dir: string;
  fingerprint: string;
  lastAccess: number;
  failed: boolean;
}

export class TranscodeRegistry {
  private readonly jobs = new Map<string, Job>();
  // In-flight job creations keyed by session, so concurrent ensureJob() calls
  // for the same session share ONE creation instead of racing (which would
  // orphan an ffmpeg + temp dir and bypass the maxTranscodes cap).
  private readonly pending = new Map<
    string,
    { fingerprint: string; promise: Promise<string> }
  >();
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
      for (const child of job.children) child.kill("SIGTERM");
    } catch {
      /* already stopped */
    }
    const force = setTimeout(() => {
      try {
        for (const child of job.children) child.kill("SIGKILL");
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
  async ensureJob(
    sessionId: string,
    upstreamUrl: string,
    options: HlsTranscodeOptions = {},
  ): Promise<string> {
    const normalizedOptions: HlsTranscodeOptions = {
      profile: options.profile ?? "adaptive",
      startSeconds: Math.max(0, Math.floor(options.startSeconds ?? 0)),
      hdrPolicy: options.hdrPolicy ?? "auto",
      preserveSubtitles: options.preserveSubtitles === true,
      videoEncoder: options.videoEncoder ?? this.config.transcodeVideoEncoder,
    };
    const fingerprint = JSON.stringify(normalizedOptions);
    const existing = this.jobs.get(sessionId);
    if (existing != null && existing.fingerprint === fingerprint) {
      existing.lastAccess = Date.now();
      return existing.dir;
    }
    if (existing != null) await this.kill(sessionId);
    // Coalesce concurrent creations for the same session into one promise.
    const inflight = this.pending.get(sessionId);
    if (inflight != null) {
      if (inflight.fingerprint === fingerprint) return inflight.promise;
      // A request changed profile/offset while the first FFmpeg startup was in
      // flight. Let that creation settle, then re-evaluate and replace it so we
      // never return a manifest for the wrong playback timeline.
      await inflight.promise.catch(() => undefined);
      return this.ensureJob(sessionId, upstreamUrl, options);
    }
    const created = this.createJob(
      sessionId,
      upstreamUrl,
      normalizedOptions,
      fingerprint,
    ).finally(() =>
      this.pending.delete(sessionId),
    );
    this.pending.set(sessionId, { fingerprint, promise: created });
    return created;
  }

  private async createJob(
    sessionId: string,
    upstreamUrl: string,
    options: HlsTranscodeOptions,
    fingerprint: string,
  ): Promise<string> {
    // Include creations that have passed validation but have not registered
    // their child yet. Otherwise two sessions can both observe an empty jobs
    // map before their first await and exceed the operator's process cap.
    if (this.jobs.size + this.pending.size >= this.config.maxTranscodes) {
      throw Object.assign(new Error("The transcoder is busy. Try again shortly."), { statusCode: 503 });
    }

    await mkdir(this.config.dataDir, { recursive: true });
    const dir = await mkdtemp(join(this.config.dataDir, "transcode-"));
    let child: ChildProcess;
    const streamProbe =
      this.transcoder.probeStreams == null
        ? null
        : await this.transcoder.probeStreams(upstreamUrl);
    const processOptions = {
      ...options,
      includeAudio: streamProbe?.audio ?? true,
      includeSubtitle:
        options.preserveSubtitles === true && streamProbe?.subtitle === true,
    };
    if (options.preserveSubtitles) {
      // Keep the advertised subtitle rendition valid when the source has no
      // embedded subtitle stream or stream probing is unavailable. When a
      // track exists, the one main FFmpeg process replaces this placeholder.
      await writeFile(join(dir, "subtitles.vtt"), "WEBVTT\n\n", "utf8");
    }
    try {
      child = this.transcoder.spawnHls(
        hlsArgs(upstreamUrl, dir, processOptions),
      );
    } catch (err) {
      // spawn threw synchronously (e.g. fd/memory exhaustion) BEFORE the job was
      // registered - rm the orphaned dir now (the boot sweep only knows about
      // dirs recorded on a session row, so it could never reclaim this one).
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const children = [child];
    const job: Job = {
      children,
      dir,
      fingerprint,
      lastAccess: Date.now(),
      failed: false,
    };
    this.jobs.set(sessionId, job);
    this.db.sqlite.prepare("UPDATE stream_sessions SET transcode_dir = ? WHERE id = ?").run(dir, sessionId);
    // Prevent an unhandled spawn error from crashing the server and let startup
    // fail immediately when FFmpeg exits before producing a playable segment.
    for (const process of children) {
      process.once("error", () => {
        job.failed = true;
      });
      process.once("exit", (code) => {
        if (code !== 0) job.failed = true;
      });
    }

    const manifest = join(dir, MANIFEST_NAME);
    const firstSeg = join(
      dir,
      options.profile === "adaptive" ? FIRST_ADAPTIVE_SEGMENT : FIRST_SEGMENT,
    );
    const deadline = Date.now() + this.config.transcodeStartTimeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(manifest) && existsSync(firstSeg)) return dir;
      if (job.failed) {
        await this.kill(sessionId);
        throw Object.assign(
          new Error("The transcode process stopped before playback was ready."),
          { statusCode: 502 },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await this.kill(sessionId);
    throw Object.assign(new Error("The transcode did not start in time."), { statusCode: 504 });
  }
}
