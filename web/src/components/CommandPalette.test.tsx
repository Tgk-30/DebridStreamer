// @vitest-environment jsdom
//
// Behavioral tests for the ⌘K command palette: open/close via keyboard, query
// filtering (incl. the always-on catalog-search row), arrow/enter selection,
// action dispatch (navigate / theme / welcome tour / catalog search), and the
// scrim/Escape close paths.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks --------------------------------------------------------------

const navigate = vi.fn();
const search = vi.fn();
const updateSettings = vi.fn();
let storeSettings = { theme: "aurora" };

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    navigate,
    search,
    settings: storeSettings,
    updateSettings,
  }),
}));

// Icon renders a simple stub carrying its name so we can assert on icons if
// needed without pulling in lucide-react SVGs.
vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

// CSS import is a no-op in jsdom but mock to be safe / fast.
vi.mock("./CommandPalette.css", () => ({}));

import { CommandPalette } from "./CommandPalette";

// jsdom does not implement scrollIntoView; the active-row effect calls it.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// Open the palette via the global ⌘K shortcut.
function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

beforeEach(() => {
  navigate.mockClear();
  search.mockClear();
  updateSettings.mockClear();
  storeSettings = { theme: "aurora" };
});

afterEach(() => {
  cleanup();
});

describe("CommandPalette", () => {
  it("is hidden until ⌘K is pressed", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();

    openPalette();

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("opens with Ctrl+K too and lists the nav + theme commands", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Nav targets.
    expect(screen.getByText("Go to Discover")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
    // Theme commands.
    expect(screen.getByText("Theme: Aurora")).toBeInTheDocument();
    expect(screen.getByText("Theme: Midnight")).toBeInTheDocument();
    // Welcome tour.
    expect(screen.getByText("Show welcome tour")).toBeInTheDocument();
  });

  it("marks the active theme with an 'Active' hint", () => {
    storeSettings = { theme: "midnight" };
    render(<CommandPalette />);
    openPalette();

    const midnight = screen.getByText("Theme: Midnight").closest("li")!;
    expect(within(midnight).getByText("Active")).toBeInTheDocument();
    // A non-active theme has no hint.
    const aurora = screen.getByText("Theme: Aurora").closest("li")!;
    expect(within(aurora).queryByText("Active")).toBeNull();
  });

  it("⌘K toggles closed when already open", () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    openPalette();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the palette", () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters commands by label/keyword and adds a catalog-search row on top", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByRole("textbox", { name: "Command palette search" });
    await user.type(input, "library");

    const options = screen.getAllByRole("option");
    // First row is always the catalog search for the typed text.
    expect(options[0]).toHaveTextContent("Search catalog for");
    expect(options[0]).toHaveTextContent("library");
    // The "Go to Library" nav command survives the filter.
    expect(screen.getByText("Go to Library")).toBeInTheDocument();
    // A non-matching nav command is filtered out.
    expect(screen.queryByText("Go to Calendar")).toBeNull();
  });

  it("shows 'No matches' only for the catalog row's siblings when nothing else matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByRole("textbox", { name: "Command palette search" });
    await user.type(input, "zzzznotathing");

    // The catalog-search row is always present, so there is exactly one option
    // and it is the search row (the "No matches" empty li never appears while a
    // query is set).
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Search catalog for");
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("dispatches navigate() and closes when a nav command is clicked", () => {
    render(<CommandPalette />);
    openPalette();

    // mouseDown is the activation handler on rows.
    fireEvent.mouseDown(screen.getByText("Go to Watchlist"));

    expect(navigate).toHaveBeenCalledWith("watchlist");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dispatches updateSettings() with the chosen theme and closes", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.mouseDown(screen.getByText("Theme: Sunset"));

    expect(updateSettings).toHaveBeenCalledWith({ theme: "sunset" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fires the welcome-guide custom event and closes", () => {
    const handler = vi.fn();
    window.addEventListener("ds:open-welcome-guide", handler);
    try {
      render(<CommandPalette />);
      openPalette();
      fireEvent.mouseDown(screen.getByText("Show welcome tour"));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      window.removeEventListener("ds:open-welcome-guide", handler);
    }
  });

  it("runs a catalog search when the search row is selected", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByRole("textbox", { name: "Command palette search" });
    await user.type(input, "blade runner");
    fireEvent.mouseDown(screen.getByText(/Search catalog for/));

    expect(search).toHaveBeenCalledWith("blade runner");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter activates the active row (defaults to the first command)", async () => {
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByRole("textbox", { name: "Command palette search" });

    // No query -> first command is "Go to Discover".
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("discover");
  });

  it("ArrowDown/ArrowUp move the active row and Enter runs it", () => {
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByRole("textbox", { name: "Command palette search" });

    // Move down twice: index 0 (Discover) -> 1 (Search) -> 2 (Library).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Up once -> index 1 (Search).
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("search");
  });

  it("ArrowUp clamps at the top and ArrowDown clamps at the bottom", () => {
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByRole("textbox", { name: "Command palette search" });

    // Already at top; ArrowUp keeps index 0 selected.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    let options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // Spam ArrowDown well past the end; last option stays selected.
    for (let i = 0; i < 50; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("hovering a row makes it active", () => {
    render(<CommandPalette />);
    openPalette();

    const settingsRow = screen.getByText("Go to Settings").closest("li")!;
    fireEvent.mouseMove(settingsRow);
    expect(settingsRow).toHaveAttribute("aria-selected", "true");
  });

  it("closes when the scrim (backdrop) is clicked", () => {
    render(<CommandPalette />);
    openPalette();
    const dialog = screen.getByRole("dialog");

    // mouseDown directly on the scrim (target === currentTarget) closes.
    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT close when a click originates inside the panel", () => {
    render(<CommandPalette />);
    openPalette();

    // mouseDown on the input (inside the panel) must not close the dialog.
    const input = screen.getByRole("textbox", { name: "Command palette search" });
    fireEvent.mouseDown(input);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("resets the query each time it re-opens", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    let input = screen.getByRole("textbox", { name: "Command palette search" });
    await user.type(input, "settings");
    expect(input).toHaveValue("settings");

    // Close and re-open.
    fireEvent.keyDown(window, { key: "Escape" });
    openPalette();

    input = screen.getByRole("textbox", { name: "Command palette search" });
    await waitFor(() => expect(input).toHaveValue(""));
  });
});
