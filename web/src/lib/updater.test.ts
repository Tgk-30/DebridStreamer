// Additive test for the auto-updater's browser/no-Tauri contract.
//
// The launch-time `checkForUpdates()` must be a safe no-op outside the desktop
// Tauri shell: it should never import the updater runtime, never throw, and
// resolve to `null` so the UpdateBanner renders nothing. The vitest environment
// is "node" (no `window`), so `isTauri()` is false here — exactly the browser /
// SSR case we want to guarantee stays inert.

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "./updater";

describe("checkForUpdates (no Tauri runtime)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to null when not running under Tauri", async () => {
    // No `window` (node env) → isTauri() is false → no-op.
    await expect(checkForUpdates()).resolves.toBeNull();
  });

  it("does not throw even if a window without the Tauri flag exists", async () => {
    // A bare window (a plain browser) still lacks __TAURI_INTERNALS__.
    vi.stubGlobal("window", {});
    await expect(checkForUpdates()).resolves.toBeNull();
  });
});
