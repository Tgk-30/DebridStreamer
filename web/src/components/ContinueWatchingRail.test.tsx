// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WatchHistoryRecord } from "../storage/models";
import { ContinueWatchingRail } from "./ContinueWatchingRail";

function record(index: number): WatchHistoryRecord {
  return {
    id: `record-${index}`,
    mediaId: `media-${index}`,
    episodeId: null,
    progressSeconds: 60,
    durationSeconds: 600,
    completed: false,
    lastWatched: "2026-01-01T00:00:00.000Z",
    streamQuality: null,
    preview: {
      id: `media-${index}`,
      type: "movie",
      title: `Title ${index}`,
      backdropPath: `/backdrop-${index}.jpg`,
    },
  };
}

describe("ContinueWatchingRail", () => {
  it("caps the home rail at eight cards", () => {
    const { container } = render(
      <ContinueWatchingRail
        records={Array.from({ length: 10 }, (_, index) => record(index))}
        onResume={() => {}}
      />,
    );
    expect(container.querySelectorAll(".cw-card")).toHaveLength(8);
  });
});
