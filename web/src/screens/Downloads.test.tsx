// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DownloadRecord } from "../storage/models";

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: { debrid: null }, navigate: vi.fn() }),
}));
vi.mock("../lib/tauri", () => ({ isTauri: () => false }));

import { Downloads, groupDownloads } from "./Downloads";

function record(overrides: Partial<DownloadRecord>): DownloadRecord {
  return {
    jobId: "job",
    mediaId: "movie",
    episodeId: null,
    title: "Movie",
    season: null,
    episode: null,
    infoHash: "hash",
    fileHint: null,
    mode: "full",
    optimizeProfile: null,
    keepAudioLangs: [],
    keepSubLangs: [],
    status: "queued",
    bytesDone: 0,
    bytesTotal: null,
    destPath: null,
    error: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Downloads honest desktop gate", () => {
  it("does not show unusable queue controls in a browser", () => {
    render(<Downloads />);
    expect(screen.getByText("Open the desktop app to download")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download desktop app/i })).toBeInTheDocument();
    expect(screen.queryByText("Your download queue is empty")).not.toBeInTheDocument();
  });
});

describe("groupDownloads", () => {
  it("separates movies and nests series episodes by show then season", () => {
    const grouped = groupDownloads([
      record({ jobId: "movie", mediaId: "m1", title: "Arrival (2016)" }),
      record({
        jobId: "show-s2e2",
        mediaId: "show-a",
        episodeId: "s2e2",
        title: "The Bear S02E02 - Pasta",
        season: 2,
        episode: 2,
      }),
      record({
        jobId: "show-s1e3",
        mediaId: "show-a",
        episodeId: "s1e3",
        title: "The Bear S01E03 - Brigade",
        season: 1,
        episode: 3,
      }),
      record({
        jobId: "other-s1e1",
        mediaId: "show-b",
        episodeId: "s1e1",
        title: "Severance S01E01 - Good News About Hell",
        season: 1,
        episode: 1,
      }),
    ]);

    expect(grouped.movies.map((item) => item.jobId)).toEqual(["movie"]);
    expect(grouped.series.map((series) => series.title)).toEqual(["The Bear", "Severance"]);
    expect(grouped.series[0]?.seasons.map((season) => season.season)).toEqual([1, 2]);
    expect(grouped.series[0]?.seasons[0]?.records.map((item) => item.jobId)).toEqual([
      "show-s1e3",
    ]);
  });
});
