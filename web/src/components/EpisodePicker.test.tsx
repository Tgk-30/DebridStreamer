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

describe("EpisodePicker - rich mode", () => {
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

  it("uses a season dropdown (not chips) when a show has many seasons", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, i) => season(i + 1));
    mockUseSeasons.mockReturnValue({ seasons: many, loading: false, source: "live" });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1)],
      loading: false,
      source: "live",
    });
    renderPicker();
    // No chip buttons past the threshold - a proper season selector instead.
    expect(screen.queryByRole("button", { name: "Season 2" })).toBeNull();
    const select = screen.getByRole("combobox", { name: "Season" });
    expect(select).toHaveValue("1");
    // Switching it browses that season (refetch) without changing the selection.
    await user.selectOptions(select, "5");
    const lastCall = mockUseEpisodes.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe(5);
  });

  it("keeps season chips for a short run (at or below the threshold)", () => {
    const six = Array.from({ length: 6 }, (_, i) => season(i + 1));
    mockUseSeasons.mockReturnValue({ seasons: six, loading: false, source: "live" });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1)],
      loading: false,
      source: "live",
    });
    renderPicker();
    expect(screen.getByRole("button", { name: "Season 6" })).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Season" }),
    ).toBeNull();
  });

  it("shows a skeleton while seasons load", () => {
    mockUseSeasons.mockReturnValue({ seasons: [], loading: true, source: "none" });
    mockUseEpisodes.mockReturnValue({ episodes: [], loading: false, source: "none" });
    renderPicker();
    expect(document.querySelector(".episode-row-skel")).not.toBeNull();
  });

  it("opens streams from the row while the check toggles the full-row watched state", async () => {
    const user = userEvent.setup();
    mockUseSeasons.mockReturnValue({
      seasons: [season(1)],
      loading: false,
      source: "live",
    });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1), episode(1, 2)],
      loading: false,
      source: "live",
    });
    const onToggleWatched = vi.fn();
    const { onSelect } = renderPicker({
      watchedEpisodeIds: new Set(["s1e1"]),
      onToggleWatched,
    });

    // The episode row remains the primary stream-opening action.
    await user.click(screen.getByRole("button", { name: /Ep 1/ }));
    expect(onSelect).toHaveBeenCalledWith({ season: 1, episode: 1 });
    expect(onToggleWatched).not.toHaveBeenCalled();

    // The adjacent check owns watched state and the full-row highlight.
    const unmark = screen.getByRole("button", { name: "Mark E1 unwatched" });
    expect(unmark).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".episode-row-item.is-watched")).not.toBeNull();
    await user.click(unmark);
    expect(onToggleWatched).toHaveBeenCalledWith({ season: 1, episode: 1 }, false);

    // E2 is unwatched and its check marks it watched.
    await user.click(screen.getByRole("button", { name: "Mark E2 watched" }));
    expect(onToggleWatched).toHaveBeenCalledWith({ season: 1, episode: 2 }, true);
  });

  it("hides the watched toggle when no handler is provided", () => {
    mockUseSeasons.mockReturnValue({
      seasons: [season(1)],
      loading: false,
      source: "live",
    });
    mockUseEpisodes.mockReturnValue({
      episodes: [episode(1, 1)],
      loading: false,
      source: "live",
    });
    renderPicker();
    expect(document.querySelector(".episode-watched-btn")).toBeNull();
  });

  it("makes the current season action primary and the entire-series action secondary", async () => {
    const user = userEvent.setup();
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
    const onToggleSeasonWatched = vi.fn();
    const onToggleSeriesWatched = vi.fn();
    renderPicker({ onToggleSeasonWatched, onToggleSeriesWatched });

    const seasonAction = screen.getByRole("button", { name: "Mark season watched" });
    const seriesAction = screen.getByRole("button", {
      name: "Mark entire series watched",
    });
    expect(seasonAction).toHaveClass("episode-rollup-btn");
    expect(seriesAction).toHaveClass("episode-rollup-series-btn");
    expect(screen.getByText("Entire series")).toBeInTheDocument();

    await user.click(seasonAction);
    expect(onToggleSeasonWatched).toHaveBeenCalledWith(
      [
        { season: 1, episode: 1 },
        { season: 1, episode: 2 },
      ],
      true,
    );
    await user.click(seriesAction);
    expect(onToggleSeriesWatched).toHaveBeenCalledWith(true);
  });
});

describe("EpisodePicker - degraded stepper", () => {
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
        "Episode guide unavailable - pick the season and episode to search.",
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
