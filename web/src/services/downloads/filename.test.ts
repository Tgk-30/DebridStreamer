import { describe, expect, it } from "vitest";
import { makeDownloadRecord } from "./DownloadManager";
import {
  downloadDestinationPath,
  optimizedOutputPath,
  rawDownloadPath,
  sanitizePathSegment,
  sourceExtension,
} from "./filename";

function record(overrides: Partial<ReturnType<typeof makeDownloadRecord>> = {}) {
  return makeDownloadRecord({
    jobId: "job-1",
    mediaId: "tmdb-1",
    title: "Inception (2010)",
    infoHash: "abc",
    mode: "full",
    ...overrides,
  });
}

describe("download filename foldering", () => {
  it("organizes a movie under its title and year and keeps its source extension", () => {
    expect(downloadDestinationPath("/Downloads", record(), "Inception.2010.mp4")).toBe(
      "/Downloads/Inception (2010)/Inception (2010).mp4",
    );
  });

  it("organizes episodes under show and zero-padded season folders", () => {
    const episode = record({
      title: "The Show S1E3 - Pilot",
      season: 1,
      episode: 3,
      episodeId: "s1e3",
    });
    expect(downloadDestinationPath("/Downloads", episode, "release.webm")).toBe(
      "/Downloads/The Show/Season 01/The Show S01E03.webm",
    );
  });

  it("sanitizes every hostile path character and normalizes whitespace", () => {
    expect(sanitizePathSegment(' A:/B*? "C" <D>|  ')).toBe("A B C D");
    const movie = record({ title: 'Bad:/Title? (2024)' });
    expect(downloadDestinationPath("/Downloads", movie, "movie.mkv")).toBe(
      "/Downloads/Bad Title (2024)/Bad Title (2024).mkv",
    );
  });

  it("uses source extensions for full jobs and fixed extensions for optimized profiles", () => {
    const remux = record({ mode: "optimized", optimizeProfile: "remux" });
    const h265 = record({ mode: "optimized", optimizeProfile: "h265" });
    expect(downloadDestinationPath("/Downloads", remux, "source.avi")).toMatch(/\.mkv$/);
    expect(downloadDestinationPath("/Downloads", h265, "source.avi")).toMatch(/\.mp4$/);
    expect(sourceExtension("folder/UPPER.MP4?token=1")).toBe("mp4");
    expect(sourceExtension("no-extension")).toBe("mkv");
  });

  it("uses a sibling source file during optimization and restores the final extension", () => {
    const remux = record({ mode: "optimized", optimizeProfile: "remux" });
    const raw = rawDownloadPath("/Downloads", remux, "source.mp4");
    expect(raw).toBe("/Downloads/Inception (2010)/Inception (2010).source.mp4");
    expect(optimizedOutputPath(raw, "remux")).toBe(
      "/Downloads/Inception (2010)/Inception (2010).mkv",
    );
    expect(optimizedOutputPath(raw, "h265")).toBe(
      "/Downloads/Inception (2010)/Inception (2010).mp4",
    );
  });
});
