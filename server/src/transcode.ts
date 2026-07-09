// ffmpeg integration surface for opt-in server-side transcoding (Phase 3b).
//
// The whole feature touches child_process through this one `Transcoder` seam, so
// tests inject a fake (via BuildAppOptions.transcoder) and never need a real
// ffmpeg binary. The real implementation probes ffmpeg once at boot and spawns
// an HLS-producing process per stream session.

import { spawn, type ChildProcess } from "node:child_process";

export interface Transcoder {
  /** Resolves true iff `ffmpeg -version` exits 0 within a short timeout. Run once
   *  at boot and cached - never per request. */
  detect(): Promise<boolean>;
  /** Spawn an ffmpeg process for the given argv (which encodes the HLS output
   *  paths). Returns the child handle so the registry can manage its lifecycle. */
  spawnHls(args: string[]): ChildProcess;
}

export const realTranscoder: Transcoder = {
  detect() {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      try {
        const probe = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
        probe.once("error", () => finish(false));
        probe.once("close", (code) => finish(code === 0));
        const timer = setTimeout(() => {
          try {
            probe.kill("SIGKILL");
          } catch {
            /* already gone */
          }
          finish(false);
        }, 2000);
        timer.unref?.();
      } catch {
        finish(false);
      }
    });
  },
  spawnHls(args) {
    // stdin ignored, stdout ignored (HLS goes to files), stderr piped so a future
    // hardening pass can capture ffmpeg errors.
    return spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  },
};
