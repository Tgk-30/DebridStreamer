import { afterEach, describe, expect, it } from "vitest";
import {
  NetworkBlockedError,
  assertNetworkAllowed,
  categoryForUrl,
  getNetworkMode,
  isNetworkAllowed,
  isUrlAllowed,
  setNetworkMode,
} from "./networkPolicy";

afterEach(() => setNetworkMode("standard"));

describe("networkPolicy", () => {
  it("defaults to standard and round-trips the mode", () => {
    expect(getNetworkMode()).toBe("standard");
    setNetworkMode("fullLocal");
    expect(getNetworkMode()).toBe("fullLocal");
    // Unknown values fall back to standard rather than blocking everything.
    setNetworkMode("nonsense" as never);
    expect(getNetworkMode()).toBe("standard");
  });

  it("standard allows every category", () => {
    setNetworkMode("standard");
    for (const c of ["metadata", "ratings", "debrid", "aiExternal", "updates", "trailer", "misc"] as const) {
      expect(isNetworkAllowed(c)).toBe(true);
    }
  });

  it("fullLocal allows the streaming essentials but blocks updates, external AI, and trailers", () => {
    setNetworkMode("fullLocal");
    expect(isNetworkAllowed("metadata")).toBe(true);
    expect(isNetworkAllowed("ratings")).toBe(true);
    expect(isNetworkAllowed("debrid")).toBe(true);
    expect(isNetworkAllowed("streaming")).toBe(true);
    expect(isNetworkAllowed("indexers")).toBe(true);
    expect(isNetworkAllowed("subtitles")).toBe(true);
    expect(isNetworkAllowed("aiLocal")).toBe(true);
    expect(isNetworkAllowed("aiExternal")).toBe(false);
    expect(isNetworkAllowed("updates")).toBe(false);
    expect(isNetworkAllowed("trailer")).toBe(false);
    expect(isNetworkAllowed("telemetry")).toBe(false);
    expect(isNetworkAllowed("misc")).toBe(false);
  });

  it("offline blocks everything that leaves the device but keeps on-device AI/server", () => {
    setNetworkMode("offline");
    for (const c of ["metadata", "ratings", "debrid", "streaming", "indexers", "subtitles", "aiExternal", "updates", "trailer", "telemetry", "misc"] as const) {
      expect(isNetworkAllowed(c)).toBe(false);
    }
    expect(isNetworkAllowed("aiLocal")).toBe(true);
    expect(isNetworkAllowed("server")).toBe(true);
  });

  it("classifies known hosts, treats loopback as on-device, and unknown as misc", () => {
    expect(categoryForUrl("https://api.themoviedb.org/3/movie/1")).toBe("metadata");
    expect(categoryForUrl("https://image.tmdb.org/t/p/w500/x.jpg")).toBe("images");
    expect(categoryForUrl("https://www.omdbapi.com/?i=tt1")).toBe("ratings");
    expect(categoryForUrl("https://api.real-debrid.com/rest/1.0")).toBe("debrid");
    expect(categoryForUrl("https://api.anthropic.com/v1/messages")).toBe("aiExternal");
    expect(categoryForUrl("https://www.youtube-nocookie.com/embed/x")).toBe("trailer");
    expect(categoryForUrl("http://localhost:11434/api/tags")).toBeNull();
    expect(categoryForUrl("http://127.0.0.1:8181/api/health")).toBeNull();
    expect(categoryForUrl("https://tracker.example.net/announce")).toBe("misc");
    expect(categoryForUrl("not a url")).toBe("misc");
  });

  it("isUrlAllowed enforces the matrix and always allows loopback", () => {
    setNetworkMode("offline");
    expect(isUrlAllowed("http://localhost:11434/api/tags")).toBe(true);
    expect(isUrlAllowed("https://api.themoviedb.org/3")).toBe(false);
    setNetworkMode("fullLocal");
    expect(isUrlAllowed("https://api.themoviedb.org/3")).toBe(true);
    expect(isUrlAllowed("https://api.anthropic.com/v1")).toBe(false);
    expect(isUrlAllowed("https://tracker.example.net")).toBe(false); // misc denied
    setNetworkMode("standard");
    expect(isUrlAllowed("https://tracker.example.net")).toBe(true);
  });

  it("assertNetworkAllowed throws a typed NetworkBlockedError when blocked", () => {
    setNetworkMode("offline");
    expect(() => assertNetworkAllowed("metadata", "TMDB.request")).toThrow(NetworkBlockedError);
    try {
      assertNetworkAllowed("metadata");
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkBlockedError);
      expect((err as NetworkBlockedError).category).toBe("metadata");
      expect((err as NetworkBlockedError).mode).toBe("offline");
    }
    setNetworkMode("standard");
    expect(() => assertNetworkAllowed("metadata")).not.toThrow();
  });
});
