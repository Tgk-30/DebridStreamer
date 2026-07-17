// @vitest-environment jsdom
//
// Component coverage for the advanced Browse filter slideover. Exercises the
// draft editing model: toggling a genre, typing a year, changing sort/rating,
// then Apply (assert the onApply payload) / Clear / Escape (onClose). The genre
// list and AppStore are stubbed so the panel renders deterministically.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterSlideover } from "./FilterSlideover";
import { emptyBrowseFilters } from "../data/browse";
import { SortOption } from "../services/metadata/types";
import type { MediaType } from "../models/media";

// Deterministic genre list (independent of TMDBService).
vi.mock("../data/genres", () => ({
  useGenres: () => [
    { id: 28, name: "Action" },
    { id: 18, name: "Drama" },
    { id: 35, name: "Comedy" },
  ],
}));

// The component only reads `services.tmdb`, which the stubbed useGenres ignores.
vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: { tmdb: null } }),
}));

function setup(overrides: Partial<React.ComponentProps<typeof FilterSlideover>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const props = {
    open: true,
    type: "movie" as MediaType,
    filters: emptyBrowseFilters(),
    onApply,
    onClose,
    ...overrides,
  };
  const utils = render(<FilterSlideover {...props} />);
  return { ...utils, onApply, onClose, props };
}

describe("FilterSlideover", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the dialog with its filter groups when open", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Group labels present.
    expect(screen.getByText("Genres")).toBeInTheDocument();
    expect(screen.getByText("Release year")).toBeInTheDocument();
    expect(screen.getByText("Min rating")).toBeInTheDocument();
    expect(screen.getByText("Sort by")).toBeInTheDocument();
  });

  it("makes its persistently mounted panel inert when closed", () => {
    const { container } = setup({ open: false });
    expect(container.querySelector(".fs-panel")).toHaveAttribute("inert");
  });

  it("shows the movie-only runtime group for a movie and hides it for series", () => {
    const { unmount } = setup({ type: "movie" });
    expect(screen.getByText("Max runtime")).toBeInTheDocument();
    unmount();
    setup({ type: "series" });
    expect(screen.queryByText("Max runtime")).not.toBeInTheDocument();
  });

  it("toggles a genre and includes it in the Apply payload", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    const action = screen.getByRole("button", { name: "Action" });
    expect(action).toHaveAttribute("aria-pressed", "false");
    await user.click(action);
    expect(action).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [type, filters] = onApply.mock.calls[0];
    expect(type).toBe("movie");
    expect(filters.genreIds).toEqual([28]);
  });

  it("toggling a genre twice removes it again", async () => {
    const user = userEvent.setup();
    setup();
    const action = screen.getByRole("button", { name: "Action" });
    await user.click(action);
    await user.click(action);
    expect(action).toHaveAttribute("aria-pressed", "false");
  });

  it("types a year range and applies plausible years (sanitized)", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    const from = screen.getByLabelText("Release year from");
    const to = screen.getByLabelText("Release year to");
    await user.type(from, "2000");
    await user.type(to, "2012");
    expect(from).toHaveValue(2000);

    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    const filters = onApply.mock.calls[0][1];
    expect(filters.yearGTE).toBe(2000);
    expect(filters.yearLTE).toBe(2012);
  });

  it("sanitizes a plausible year into the Apply payload", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.type(screen.getByLabelText("Release year from"), "2010");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply.mock.calls[0][1].yearGTE).toBe(2010);
  });

  it("treats a partial/implausible year as nothing to apply", async () => {
    const user = userEvent.setup();
    setup();
    // "20" is a real number but not a plausible 4-digit year, so it sanitizes to
    // null - leaving the draft identical to what is already applied. The primary
    // button says so rather than offering to apply a no-op.
    await user.type(screen.getByLabelText("Release year from"), "20");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("can APPLY a Clear - the whole point of the button", async () => {
    const user = userEvent.setup();
    // Start with a filter actually applied.
    const { onApply } = setup({
      filters: { ...emptyBrowseFilters(), yearGTE: 2010 },
    });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    // Clearing leaves the draft EMPTY but different from the applied filters, so
    // it must remain appliable. Treating "no filters in the draft" as "nothing
    // to do" degraded this button to "Done", which closed the panel and left the
    // filters on.
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply).toHaveBeenCalled();
    expect(onApply.mock.calls[0][1].yearGTE).toBeNull();
  });

  it("changes the sort selection and applies it", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    const rating = screen.getByRole("button", { name: "Rating" });
    expect(rating).toHaveAttribute("aria-pressed", "false");
    await user.click(rating);
    expect(rating).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply.mock.calls[0][1].sortBy).toBe(SortOption.ratingDesc);
  });

  it("selects a min rating and applies it", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.click(screen.getByRole("button", { name: "7+" }));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onApply.mock.calls[0][1].minRating).toBe(7);
  });

  it("Clear is disabled with no active filters and resets the draft once dirty", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Action" }));
    expect(clear).toBeEnabled();
    await user.click(clear);
    expect(screen.getByRole("button", { name: "Action" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(clear).toBeDisabled();
    // Applying after Clear: changing the genre then clearing leaves the draft
    // empty, so the apply button reverts to "Done" and closes instead of apply.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("switching the media type clears selected genres in the payload", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ type: "movie" });
    // Select a genre, then switch type - genres invalidate.
    await user.click(screen.getByRole("button", { name: "Action" }));
    await user.click(screen.getByRole("button", { name: "TV" }));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    const [type, filters] = onApply.mock.calls[0];
    expect(type).toBe("series");
    expect(filters.genreIds).toEqual([]);
  });

  it("shows 'Done' (not 'Apply filters') when the draft is unchanged, and Done closes", async () => {
    const user = userEvent.setup();
    const { onClose, onApply } = setup();
    const apply = screen.getByRole("button", { name: "Done" });
    expect(apply).toBeInTheDocument();
    await user.click(apply);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closes via the header close button", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close filters" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed (modal a11y)", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the scrim closes the panel but clicking inside it does not", async () => {
    const user = userEvent.setup();
    const { onClose, container } = setup();
    // Inside the panel: stopPropagation prevents the scrim handler.
    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // The scrim itself.
    const scrim = container.querySelector(".fs-scrim")!;
    await user.click(scrim as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
