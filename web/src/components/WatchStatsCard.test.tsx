// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { WatchStatsCard } from "./WatchStatsCard";
import type { WatchStats } from "../data/watchStats";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

function stats(over: Partial<WatchStats> = {}): WatchStats {
  return {
    totalSeconds: 3 * 3600 + 42 * 60,
    titles: 12,
    completed: 9,
    completionRate: 0.75,
    streakDays: 4,
    streakOngoing: true,
    activeDays: 8,
    favoriteGenres: [
      { genre: "Action", count: 6 },
      { genre: "Sci-Fi", count: 3 },
    ],
    ...over,
  };
}

afterEach(cleanup);

describe("WatchStatsCard", () => {
  it("renders the headline tiles", () => {
    render(<WatchStatsCard stats={stats()} />);
    expect(screen.getByText("3h 42m")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // titles
    expect(screen.getByText("75%")).toBeInTheDocument(); // completion
    expect(screen.getByText("4 days")).toBeInTheDocument(); // streak
  });

  it("renders a favourite-genres bar per genre, widths proportional to the max", () => {
    const { container } = render(<WatchStatsCard stats={stats()} />);
    const rows = container.querySelectorAll(".watch-stats-bar-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("Action")).toBeInTheDocument();
    const fills = container.querySelectorAll(".watch-stats-bar-fill");
    // Top genre (6) fills 100%, the next (3) fills 50%.
    expect((fills[0] as HTMLElement).style.width).toBe("100%");
    expect((fills[1] as HTMLElement).style.width).toBe("50%");
  });

  it("omits the genres section when there are no liked-genre signals", () => {
    const { container } = render(
      <WatchStatsCard stats={stats({ favoriteGenres: [] })} />,
    );
    expect(container.querySelector(".watch-stats-genres")).toBeNull();
  });

  it("renders a 0% genre bar width when all genre counts are zero", () => {
    const { container } = render(
      <WatchStatsCard stats={stats({ favoriteGenres: [{ genre: "Calm", count: 0 }] })} />,
    );
    expect(container.querySelector(".watch-stats-genres")).not.toBeNull();
    const fill = container.querySelector(".watch-stats-bar-fill");
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe("0%");
  });

  it("shows a dash and no accent for a broken (zero-day) streak", () => {
    render(
      <WatchStatsCard stats={stats({ streakDays: 0, streakOngoing: false })} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a singular day label when streak is exactly one day", () => {
    render(
      <WatchStatsCard stats={stats({ streakDays: 1, streakOngoing: true })} />,
    );
    expect(screen.getByText("1 day")).toBeInTheDocument();
  });
});
