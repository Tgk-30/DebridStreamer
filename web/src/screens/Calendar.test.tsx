// @vitest-environment jsdom
//
// Render tests for the Calendar screen. It reads the agenda from useCalendar
// (mocked here) and the app store (services + openDetail), then renders one of
// five states: loading skeleton, error, no-TMDB, no-series, empty-agenda, or the
// grouped episode rows. Each loaded row is a button that opens the show's Detail
// and shows the poster (or a placeholder when no posterPath) plus the SxxExx code
// and air date.
//
// useCalendar is mocked so we drive every state directly; the store is stubbed to
// capture openDetail. EmptyState / Icon render for real (light deps).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type { UpcomingEpisode } from "../lib/metadata";
import type { CalendarState } from "../data/calendar";

// --- mutable mock state -----------------------------------------------------

const openDetail = vi.fn();
const fakeTmdb = { tag: "tmdb" } as const;
let calendarState: CalendarState;

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    services: { tmdb: fakeTmdb },
    openDetail,
  }),
}));

vi.mock("../data/calendar", () => ({
  useCalendar: () => calendarState,
}));

import { Calendar } from "./Calendar";

// --- helpers ----------------------------------------------------------------

function series(id: string, title: string, posterPath: string | null = null): MediaPreview {
  return { id, type: "series", title, posterPath };
}

function ep(
  s: MediaPreview,
  seasonNumber: number,
  episodeNumber: number,
  airDate: string,
  title?: string,
): UpcomingEpisode {
  return { series: s, seasonNumber, episodeNumber, airDate, title } as UpcomingEpisode;
}

function baseState(over: Partial<CalendarState>): CalendarState {
  return {
    groups: [],
    loading: false,
    error: null,
    hasSeries: true,
    hasTMDB: true,
    ...over,
  };
}

beforeEach(() => {
  openDetail.mockClear();
  calendarState = baseState({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Calendar — non-loaded states", () => {
  it("renders the skeleton groups while loading", () => {
    calendarState = baseState({ loading: true });
    const { container } = render(<Calendar />);
    // Two skeleton groups, three skeleton rows each.
    expect(container.querySelectorAll(".cal-group")).toHaveLength(2);
    expect(container.querySelectorAll(".cal-row-skel")).toHaveLength(6);
    // The skeleton block is hidden from a11y tree.
    expect(container.querySelector(".cal-groups")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders the error empty-state with the failure note", () => {
    calendarState = baseState({ error: "TMDB down" });
    render(<Calendar />);
    expect(screen.getByText("Couldn't load the calendar")).toBeInTheDocument();
    expect(screen.getByText("TMDB down")).toBeInTheDocument();
  });

  it("renders the no-TMDB-key empty-state", () => {
    calendarState = baseState({ hasTMDB: false });
    render(<Calendar />);
    expect(
      screen.getByText("Add a TMDB key to see air dates"),
    ).toBeInTheDocument();
  });

  it("renders the no-series empty-state", () => {
    calendarState = baseState({ hasSeries: false });
    render(<Calendar />);
    expect(screen.getByText("No shows to track yet")).toBeInTheDocument();
  });

  it("renders the nothing-on-the-horizon empty-state when groups are empty", () => {
    calendarState = baseState({ groups: [] });
    render(<Calendar />);
    expect(screen.getByText("Nothing on the horizon")).toBeInTheDocument();
  });
});

describe("Calendar — loaded agenda", () => {
  it("renders grouped rows with code + air date and opens detail on click", async () => {
    const show = series("s1", "Severance", "/poster.jpg");
    calendarState = baseState({
      groups: [
        {
          bucket: "today",
          label: "Today",
          episodes: [ep(show, 2, 7, "2026-06-25", "Cold Harbor")],
        },
      ],
    });
    render(<Calendar />);

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    // The button's title attr is the open-hint; its a11y name is its text.
    const row = screen.getByTitle("Open Severance");
    // SxxExx code is zero-padded.
    expect(within(row).getByText("S02E07")).toBeInTheDocument();
    expect(within(row).getByText("Cold Harbor")).toBeInTheDocument();
    // Poster img is used when a posterPath exists.
    const img = within(row).getByRole("img", { name: "Severance" });
    expect(img).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );

    await userEvent.click(row);
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", title: "Severance" }),
    );
  });

  it("falls back to a placeholder icon when the series has no poster", () => {
    const show = series("s2", "Andor", null);
    calendarState = baseState({
      groups: [
        {
          bucket: "later",
          label: "Upcoming",
          episodes: [ep(show, 1, 3, "2026-07-01")],
        },
      ],
    });
    const { container } = render(<Calendar />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".cal-row-poster-ph")).toBeInTheDocument();
  });

  it("omits the episode title span when the episode has no title", () => {
    const show = series("s3", "Foundation", "/p.jpg");
    calendarState = baseState({
      groups: [
        {
          bucket: "week",
          label: "This week",
          episodes: [ep(show, 4, 1, "2026-06-28")],
        },
      ],
    });
    const { container } = render(<Calendar />);
    expect(screen.getByText("S04E01")).toBeInTheDocument();
    expect(container.querySelector(".cal-eptitle")).not.toBeInTheDocument();
  });

  it("renders the raw ISO string when the air date is unparseable", () => {
    const show = series("s4", "Mystery", "/p.jpg");
    calendarState = baseState({
      groups: [
        {
          bucket: "later",
          label: "Upcoming",
          episodes: [ep(show, 1, 1, "not-a-date")],
        },
      ],
    });
    render(<Calendar />);
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
