// @vitest-environment jsdom
//
// Render/interaction tests for the NavRail component (the pure gating helpers
// are covered in NavRail.test.ts). Exercises: which buttons render under each
// mode, active state, the select click handler, the mobile More drawer toggle,
// and the Server-Mode profile-switch entry.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { NavRail } from "./NavRail";
import {
  ServerSessionProvider,
  type ServerSession,
  type ServerProfileSummary,
} from "../lib/ServerSessionContext";

let mockServerMode = false;
let mockSimpleMode = false;

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));
vi.mock("../store/AppStore", () => ({
  useSimpleMode: () => mockSimpleMode,
}));

afterEach(() => {
  mockServerMode = false;
  mockSimpleMode = false;
  vi.clearAllMocks();
});

function renderRail(
  props: Parameters<typeof NavRail>[0],
  ctx?: {
    session?: ServerSession | null;
    profiles?: ServerProfileSummary[];
  },
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerSessionProvider
      initial={ctx?.session ?? null}
      initialProfiles={ctx?.profiles ?? []}
    >
      {children}
    </ServerSessionProvider>
  );
  return render(<NavRail {...props} />, { wrapper });
}

describe("NavRail render", () => {
  it("renders all nine destinations in the full local+advanced experience", () => {
    renderRail({ selected: "discover", onSelect: () => {} });
    for (const label of [
      "Discover",
      "Search",
      "Library",
      "Watchlist",
      "Calendar",
      "History",
      "Assistant",
      "Debrid",
      "Settings",
    ]) {
      // Each rail button uses the label as its aria-label.
      expect(
        screen.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("keeps Calendar reachable in Advanced mode", async () => {
    mockSimpleMode = false;
    const onSelect = vi.fn();
    renderRail({ selected: "calendar", onSelect });

    const calendar = screen.getByRole("button", { name: "Calendar" });
    expect(calendar).toHaveAttribute("aria-current", "page");
    await userEvent.click(calendar);
    expect(onSelect).toHaveBeenCalledWith("calendar");
  });

  it("marks the selected screen with aria-current=page and is-selected", () => {
    const { container } = renderRail({ selected: "library", onSelect: () => {} });
    const lib = screen.getByRole("button", { name: "Library" });
    expect(lib).toHaveAttribute("aria-current", "page");
    expect(lib).toHaveClass("is-selected");
    // A non-selected button has neither.
    const search = screen.getByRole("button", { name: "Search" });
    expect(search).not.toHaveAttribute("aria-current");
    expect(search).not.toHaveClass("is-selected");
    // Sanity: exactly one rail button carries aria-current.
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
  });

  it("invokes onSelect with the screen id when a rail button is clicked", async () => {
    const onSelect = vi.fn();
    renderRail({ selected: "discover", onSelect });
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("hides Debrid in Server Mode", () => {
    mockServerMode = true;
    renderRail({ selected: "discover", onSelect: () => {} });
    expect(screen.queryByRole("button", { name: "Debrid" })).toBeNull();
    // Assistant still shows in Server Mode (routes to /api/ai/recommend).
    expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument();
  });

  it("hides the power-user trio in Simple mode but keeps Settings", () => {
    mockSimpleMode = true;
    renderRail({ selected: "discover", onSelect: () => {} });
    expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Debrid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Calendar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    // With every tool gated off, the empty "Tools" group label disappears too
    // (an orphaned section header reads as a broken menu).
    expect(screen.queryByText("Tools")).toBeNull();
  });

  it("toggles the mobile More drawer open and closed", async () => {
    renderRail({ selected: "discover", onSelect: () => {} });
    const more = screen.getByRole("button", { name: "More navigation" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Close more menu" })).toBeNull();

    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const close = screen.getByRole("button", { name: "Close more menu" });
    expect(close).toBeInTheDocument();

    await userEvent.click(close);
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("selecting a More-drawer action fires onSelect and closes the drawer", async () => {
    const onSelect = vi.fn();
    renderRail({ selected: "discover", onSelect });
    await userEvent.click(screen.getByRole("button", { name: "More navigation" }));

    const sheet = document.getElementById("mobile-nav-more");
    expect(sheet).not.toBeNull();
    // Calendar lives in the More sheet (it is not a mobile primary item).
    const calendarAction = within(sheet as HTMLElement).getByRole("button", {
      name: "Calendar",
    });
    await userEvent.click(calendarAction);
    expect(onSelect).toHaveBeenCalledWith("calendar");
    // Drawer closes after selection.
    expect(document.getElementById("mobile-nav-more")).toBeNull();
  });

  it("does not show the profile switch in Local Mode", () => {
    renderRail(
      { selected: "discover", onSelect: () => {}, onSwitchProfile: () => {} },
      {
        session: makeSession("Alice"),
        profiles: [makeProfile("p1", "Alice"), makeProfile("p2", "Bob")],
      },
    );
    expect(
      screen.queryByRole("button", { name: /Switch profile/ }),
    ).toBeNull();
  });

  it("shows the profile switch in Server Mode with a handler and >1 profile", async () => {
    mockServerMode = true;
    const onSwitchProfile = vi.fn();
    renderRail(
      { selected: "discover", onSelect: () => {}, onSwitchProfile },
      {
        session: makeSession("Alice"),
        profiles: [makeProfile("p1", "Alice"), makeProfile("p2", "Bob")],
      },
    );
    const sw = screen.getByRole("button", {
      name: "Switch profile (current: Alice)",
    });
    // Avatar initial is the uppercased first character of the display name.
    expect(within(sw).getByText("A")).toBeInTheDocument();
    await userEvent.click(sw);
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
  });

  it("hides the profile switch with a single profile (nobody to switch to)", () => {
    mockServerMode = true;
    renderRail(
      { selected: "discover", onSelect: () => {}, onSwitchProfile: () => {} },
      {
        session: makeSession("Alice"),
        profiles: [makeProfile("p1", "Alice")],
      },
    );
    expect(
      screen.queryByRole("button", { name: /Switch profile/ }),
    ).toBeNull();
  });
});

function makeSession(displayName: string): ServerSession {
  return {
    profileId: "p1",
    username: displayName.toLowerCase(),
    displayName,
    role: "owner",
    avatarColor: "#123456",
    simpleMode: false,
  };
}

function makeProfile(id: string, displayName: string): ServerProfileSummary {
  return {
    id,
    displayName,
    avatarColor: "#123456",
    simpleMode: false,
    isDefault: id === "p1",
    isKid: false,
  };
}
