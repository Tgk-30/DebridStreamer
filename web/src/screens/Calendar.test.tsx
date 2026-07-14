// @vitest-environment jsdom
//
// Render coverage for the release calendar. Data resolution is tested in
// data/calendar.hook.test.tsx; these tests exercise the month layout, date
// grouping, empty states, navigation, today treatment, and Detail hand-off.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type { CalendarEntry, CalendarState } from "../data/calendar";

const openDetail = vi.fn();
const fakeTmdb = { tag: "tmdb" } as const;
let calendarState: CalendarState;

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: { tmdb: fakeTmdb }, openDetail }),
}));

vi.mock("../data/calendar", () => ({
  useCalendar: () => calendarState,
}));

import { Calendar } from "./Calendar";

function localDate(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function preview(
  id: string,
  title: string,
  type: MediaPreview["type"] = "series",
  posterPath: string | null = "/poster.jpg",
): MediaPreview {
  return { id, type, title, posterPath };
}

function entry(
  media: MediaPreview,
  date: string,
  kind: CalendarEntry["kind"] = "episode",
  detail = "S02E07 · Cold Harbor",
): CalendarEntry {
  return {
    id: `${kind}:${media.id}:${date}`,
    date,
    media,
    kind,
    detail,
    ...(kind === "movie" ? { source: "upcoming" as const } : {}),
  };
}

function baseState(over: Partial<CalendarState> = {}): CalendarState {
  return {
    entries: [],
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
  calendarState = baseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Calendar states", () => {
  it("renders a six-week loading calendar while data resolves", () => {
    calendarState = baseState({ loading: true });
    const { container } = render(<Calendar />);
    expect(container.querySelector(".cal-month--loading")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelectorAll(".cal-day--skel")).toHaveLength(42);
  });

  it("renders the error, no-key, no-followed-show, and no-schedule states", () => {
    const { rerender } = render(<Calendar />);
    expect(screen.getByText("Nothing scheduled right now")).toBeInTheDocument();

    calendarState = baseState({ hasSeries: false });
    rerender(<Calendar />);
    expect(screen.getByText("No followed shows yet")).toBeInTheDocument();

    calendarState = baseState({ hasTMDB: false });
    rerender(<Calendar />);
    expect(screen.getByText("Add a TMDB key to see release dates")).toBeInTheDocument();

    calendarState = baseState({ error: "TMDB down" });
    rerender(<Calendar />);
    expect(screen.getByText("Couldn't load the release calendar")).toBeInTheDocument();
    expect(screen.getByText("TMDB down")).toBeInTheDocument();
  });
});

describe("Calendar cadence", () => {
  it("places mocked followed-show and TMDB movie entries on one date and groups them in the agenda", async () => {
    const show = preview("show-1", "Severance");
    const movie = preview("movie-1", "The Running Man", "movie");
    const date = localDate(2);
    calendarState = baseState({
      entries: [
        entry(show, date),
        entry(movie, date, "movie", "Movie release · Upcoming"),
      ],
    });
    render(<Calendar />);

    const dateHeading = screen.getByRole("heading", {
      name: new RegExp(new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })),
    });
    const daySection = dateHeading.closest("section");
    expect(daySection).not.toBeNull();
    expect(within(daySection as HTMLElement).getByText("Severance")).toBeInTheDocument();
    expect(within(daySection as HTMLElement).getByText("The Running Man")).toBeInTheDocument();
    expect(screen.getAllByText("Movie release").length).toBeGreaterThan(0);

    const openButtons = screen.getAllByTitle("Open Severance");
    await userEvent.click(openButtons[0]!);
    expect(openDetail).toHaveBeenCalledWith(show);
    expect(within(screen.getAllByTitle("Open Severance")[1]!).getByRole("img", {
      name: "Severance",
    })).toHaveAttribute("src", "https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  it("shows a tiny poster on each month-grid event, falling back to a placeholder", () => {
    const date = localDate(2);
    calendarState = baseState({
      entries: [
        entry(preview("with-art", "Severance"), date),
        entry(preview("no-art", "Andor", "series", null), date),
      ],
    });
    render(<Calendar />);

    // [0] is the month-grid chip; [1] is the agenda row for the same entry.
    const chip = screen.getAllByTitle("Open Severance")[0]!;
    const thumb = chip.querySelector("img.cal-event-thumb");
    expect(thumb).toHaveAttribute("src", "https://image.tmdb.org/t/p/w342/poster.jpg");
    // Decorative: the chip's own aria-label already announces the title.
    expect(thumb).toHaveAttribute("alt", "");

    const bare = screen.getAllByTitle("Open Andor")[0]!;
    expect(bare.querySelector("img.cal-event-thumb")).toBeNull();
    expect(bare.querySelector(".cal-event-thumb.is-placeholder")).not.toBeNull();
  });

  it("marks today's day and labels the agenda group as Today", () => {
    const show = preview("show-today", "Andor", "series", null);
    calendarState = baseState({ entries: [entry(show, localDate())] });
    const { container } = render(<Calendar />);
    expect(screen.getByRole("gridcell", { name: /today$/ })).toHaveClass("is-today");
    expect(screen.getByRole("heading", { name: /^Today · / })).toBeInTheDocument();
    expect(container.querySelector(".cal-release-poster-ph")).toBeInTheDocument();
  });

  it("navigates backward and forward between months", async () => {
    calendarState = baseState({ entries: [entry(preview("show-2", "Foundation"), localDate())] });
    render(<Calendar />);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" },
    );
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" },
    );

    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: next })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`No releases scheduled in ${next}`))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: previous })).toBeInTheDocument();
  });
});
