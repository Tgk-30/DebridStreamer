// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const isServerMode = vi.hoisted(() => vi.fn(() => false));
const isTraktConnected = vi.hoisted(() => vi.fn());
const getValidAccessToken = vi.hoisted(() => vi.fn());
const scrobbleStart = vi.hoisted(() => vi.fn());
const scrobblePause = vi.hoisted(() => vi.fn());
const scrobbleStop = vi.hoisted(() => vi.fn());

vi.mock("../lib/serverMode", () => ({ isServerMode }));
vi.mock("./traktConnection", () => ({
  isTraktConnected,
  getValidAccessToken,
}));
vi.mock("../services/sync/TraktSyncService", () => ({
  TraktSyncService: class {
    scrobbleStart(...args: unknown[]) {
      return scrobbleStart(...args);
    }
    scrobblePause(...args: unknown[]) {
      return scrobblePause(...args);
    }
    scrobbleStop(...args: unknown[]) {
      return scrobbleStop(...args);
    }
  },
}));

import {
  configureTraktScrobble,
  scrobblePlaybackPause,
  scrobblePlaybackStart,
  scrobblePlaybackStop,
} from "./traktScrobble";

function enable(): void {
  configureTraktScrobble({
    enabled: true,
    clientId: "client-id",
    clientSecret: "client-secret",
  });
}

beforeEach(() => {
  configureTraktScrobble({ enabled: false, clientId: "", clientSecret: "" });
  vi.clearAllMocks();
  isServerMode.mockReturnValue(false);
  isTraktConnected.mockResolvedValue(true);
  getValidAccessToken.mockResolvedValue("access-token");
  scrobbleStart.mockResolvedValue(undefined);
  scrobblePause.mockResolvedValue(undefined);
  scrobbleStop.mockResolvedValue(undefined);
});

describe("traktScrobble gates", () => {
  it("is off by default and performs no network or keychain work", async () => {
    const result = scrobblePlaybackStart({ tmdbId: 603, type: "movie" });

    expect(result).toBeUndefined();
    await Promise.resolve();
    expect(isTraktConnected).not.toHaveBeenCalled();
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(scrobbleStart).not.toHaveBeenCalled();
  });

  it("does not scrobble in Server Mode", async () => {
    enable();
    isServerMode.mockReturnValue(true);
    scrobblePlaybackStart({ tmdbId: 604, type: "movie" });

    await Promise.resolve();
    expect(isTraktConnected).not.toHaveBeenCalled();
    expect(scrobbleStart).not.toHaveBeenCalled();
  });
});

describe("traktScrobble lifecycle", () => {
  it("starts once, then starts again after a user pause resumes playback", async () => {
    enable();
    const ctx = { tmdbId: 605, type: "movie" as const, progressPct: 3 };

    scrobblePlaybackStart(ctx);
    scrobblePlaybackStart(ctx);
    await waitFor(() => expect(scrobbleStart).toHaveBeenCalledTimes(1));
    expect(scrobbleStart).toHaveBeenLastCalledWith("client-id", "access-token", {
      type: "movie",
      tmdbID: 605,
      progress: 3,
    });

    scrobblePlaybackPause(ctx, 45.5);
    await waitFor(() => expect(scrobblePause).toHaveBeenCalledTimes(1));
    expect(scrobblePause).toHaveBeenLastCalledWith("client-id", "access-token", {
      type: "movie",
      tmdbID: 605,
      progress: 45.5,
    });

    scrobblePlaybackStart({ ...ctx, progressPct: 46 });
    await waitFor(() => expect(scrobbleStart).toHaveBeenCalledTimes(2));
  });

  it("sends a clamped episode stop progress and ignores the duplicate unmount stop", async () => {
    enable();
    const ctx = { tmdbId: 1399, type: "series" as const, season: 5, episode: 2 };

    scrobblePlaybackStart(ctx);
    await waitFor(() => expect(scrobbleStart).toHaveBeenCalledTimes(1));
    scrobblePlaybackStop(ctx, 120);
    scrobblePlaybackStop(ctx, 99);

    await waitFor(() => expect(scrobbleStop).toHaveBeenCalledTimes(1));
    expect(scrobbleStop).toHaveBeenCalledWith("client-id", "access-token", {
      type: "episode",
      tmdbID: 1399,
      season: 5,
      episode: 2,
      progress: 100,
    });
  });

  it("swallows Trakt failures and logs a debug diagnostic", async () => {
    enable();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    scrobbleStop.mockRejectedValueOnce(new Error("Trakt unavailable"));

    expect(() => scrobblePlaybackStop({ tmdbId: 606, type: "movie" }, 80)).not.toThrow();
    await waitFor(() => expect(debug).toHaveBeenCalledWith(
      "[trakt] scrobble failed",
      expect.any(Error),
    ));
  });
});
