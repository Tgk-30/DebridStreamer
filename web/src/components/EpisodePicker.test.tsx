// @vitest-environment jsdom
//
// EpisodePicker behavior: rich mode (season chips + episode rows + selection +
// resume bars), the season-switch refetch, the loading skeleton, and the
// degraded stepper (no episode guide) with its min-clamp + onSelect payloads.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../data/episodes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/episodes")>();
  return {
    ...actual,
    useSeasons: (...args: unknown[]) => mockUseSeasons(...args),
    useEpisodes: (...args: unknown[]) => mockUseEpisodes(...args),
  };
});

const mockUseSeasons = vi.fn();
const mockUseEpisodes = vi.fn();

import { EpisodePicker } from "./EpisodePicker";
import type { Episode, Season } from "../models/media";

function season(n: number, over: Partial<Season> = {}): Season {
  return { id: n, seasonNumber: n, name: `Season ${n}`, episodeCount: 8, ...over };
}
function episode(s: number, e: number, over: Partial<Episode> = {}): Episode {
  return {
    id: `42-s${s}e${e}`,
    mediaId: "tmdb-42",
    seasonNumber: s,
    episodeNumber: e,
    title: `Ep ${e}`,
    overview: null,
    airDate: null,
    stillPath: null,
    runtime: 45,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  mockUseSeasons.mockReset();
  mockUseEpisodes.mockReset();
});

function renderPicker(over: Partial<Parameters<typeof EpisodePicker>[0]> = {}) {
  const props = {
    tmdbId: 42,
    tmdb: null,
    selected: { season: 1, episode: 1 },
    onSelect: vi.fn(),
    ...over,
  };
  render(<EpisodePicker {...props} />);
  return props;
}

describe("EpisodePicker — rich mode", () => {
  it("renders season chips + episode rows and marks the selection", () => {
    mockUseSeasons.mockReturnValue({
      seasons: [season(1), season(2)],
      loading: false,
      source: "live",
    });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1), episode(1, 2)],
      loading: false,
      source: "live",
    });
    renderPicker({ progressByEpisodeId: { s1e2: 0.5 } });

    expect(screen.getByRole("button", { name: "Season 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const rows = screen.getAllByRole("button", { name: /Ep \d/ });
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("is-selected");
    expect(rows[1].className).not.toContain("is-selected");
    // resume bar renders only on the episode that has progress
    expect(within(rows[1]).getByText("Ep 2")).toBeInTheDocument();
    expect(rows[1].querySelector(".episode-progress-fill")).not.toBeNull();
    expect(rows[0].querySelector(".episode-progress-fill")).toBeNull();
  });

  it("selecting an episode reports the season/episode payload", async () => {
    const user = userEvent.setup();
    mockUseSeasons.mockReturnValue({
      seasons: [season(1)],
      loading: false,
      source: "live",
    });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 3)],
      loading: false,
      source: "live",
    });
    const { onSelect } = renderPicker();
    await user.click(screen.getByRole("button", { name: /Ep 3/ }));
    expect(onSelect).toHaveBeenCalledWith({ season: 1, episode: 3 });
  });

  it("switching seasons refetches that season's episodes without changing the selection", async () => {
    const user = userEvent.setup();
    mockUseSeasons.mockReturnValue({
      seasons: [season(1), season(2)],
      loading: false,
      source: "live",
    });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1)],
      loading: false,
      source: "live",
    });
    const { onSelect } = renderPicker();
    await user.click(screen.getByRole("button", { name: "Season 2" }));
    // Browsing is not selecting: no onSelect, but useEpisodes now asked for S2.
    expect(onSelect).not.toHaveBeenCalled();
    const lastCall = mockUseEpisodes.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe(2);
  });

  it("shows a skeleton while seasons load", () => {
    mockUseSeasons.mockReturnValue({ seasons: [], loading: true, source: "none" });
    mockUseEpisodes.mockReturnValue({ episodes: [], loading: false, source: "none" });
    renderPicker();
    expect(document.querySelector(".episode-row-skel")).not.toBeNull();
  });
});

describe("EpisodePicker — degraded stepper", () => {
  function mockNoGuide() {
    mockUseSeasons.mockReturnValue({ seasons: [], loading: false, source: "none" });
    mockUseEpisodes.mockReturnValue({ episodes: [], loading: false, source: "none" });
  }

  it("explains the degraded mode and steps season/episode", async () => {
    const user = userEvent.setup();
    mockNoGuide();
    const { onSelect } = renderPicker({ selected: { season: 2, episode: 5 } });

    expect(
      screen.getByText(
        "Episode guide unavailable — pick the season and episode to search.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next episode" }));
    expect(onSelect).toHaveBeenCalledWith({ season: 2, episode: 6 });

    await user.click(screen.getByRole("button", { name: "Next season" }));
    // Changing season resets the episode to 1.
    expect(onSelect).toHaveBeenCalledWith({ season: 3, episode: 1 });
  });

  it("clamps both fields at 1", async () => {
    const user = userEvent.setup();
    mockNoGuide();
    const { onSelect } = renderPicker({ selected: { season: 1, episode: 1 } });
    await user.click(screen.getByRole("button", { name: "Previous season" }));
    expect(onSelect).toHaveBeenCalledWith({ season: 1, episode: 1 });
    await user.click(screen.getByRole("button", { name: "Previous episode" }));
    expect(onSelect).toHaveBeenCalledWith({ season: 1, episode: 1 });
  });
});
