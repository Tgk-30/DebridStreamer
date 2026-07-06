// @vitest-environment jsdom
//
// Pure-logic tests for NavRail's exported nav-gating helpers and component
// render paths.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  isScreenHidden,
  shouldShowProfileSwitch,
  shouldRenderNavGroup,
  visibleNavItems,
  type ScreenId,
  NavRail,
} from "./NavRail";

let currentServerMode = false;
let currentSimpleMode = false;
let currentSession:
  | {
      profileId: string;
      username: string;
      displayName: string;
      role: "owner" | "admin" | "member" | "restricted";
      avatarColor?: string | null;
      simpleMode: boolean;
    }
  | null = null;
let currentProfiles: Array<{
  id: string;
  displayName: string;
  avatarColor: string | null;
  simpleMode: boolean;
  isDefault: boolean;
  isKid: boolean;
}> = [];

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => currentServerMode,
}));

vi.mock("../store/AppStore", () => ({
  useSimpleMode: () => currentSimpleMode,
}));

vi.mock("../lib/ServerSessionContext", () => ({
  useServerSession: () => currentSession,
  useServerProfiles: () => currentProfiles,
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

const ALL: ScreenId[] = [
  "discover",
  "search",
  "library",
  "watchlist",
  "calendar",
  "history",
  "assistant",
  "debrid",
  "settings",
];

describe("isScreenHidden", () => {
  it("hides nothing in the full (local + advanced) experience", () => {
    for (const id of ALL) {
      expect(isScreenHidden(id, { serverMode: false, simpleMode: false })).toBe(
        false,
      );
    }
  });
  it("hides only 'debrid' in Server Mode (server uses its own provider key)", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: true, simpleMode: false }),
    );
    expect(hidden).toEqual(["debrid"]);
  });
  it("hides the power-user trio in Simple mode, never Settings", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: false, simpleMode: true }),
    );
    expect(hidden.sort()).toEqual(["assistant", "calendar", "debrid"]);
    expect(isScreenHidden("settings", { serverMode: false, simpleMode: true })).toBe(
      false,
    );
  });
  it("unions both hidden sets when both modes are on", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: true, simpleMode: true }),
    );
    expect(hidden.sort()).toEqual(["assistant", "calendar", "debrid"]);
  });
});

describe("shouldShowProfileSwitch", () => {
  it("requires server mode + a handler + more than one profile", () => {
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 2 }),
    ).toBe(true);
  });
  it("is false if any condition fails", () => {
    expect(
      shouldShowProfileSwitch({ serverMode: false, hasHandler: true, profileCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: false, profileCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 1 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 0 }),
    ).toBe(false);
  });
});

describe("shouldRenderNavGroup", () => {
  const groupItems = [
    { id: "discover", icon: "discover" as const, label: "Discover", group: "Primary" as const },
    { id: "settings", icon: "settings" as const, label: "Settings", group: "Account" as const },
  ];

  it("renders a group when there is at least one item in that group", () => {
    expect(shouldRenderNavGroup("Primary", groupItems, false)).toBe(true);
    expect(shouldRenderNavGroup("Tools", groupItems, false)).toBe(false);
  });

  it("renders Account when no account items exist but the switcher is available", () => {
    expect(
      shouldRenderNavGroup(
        "Account",
        [{ id: "discover", icon: "discover", label: "Discover", group: "Primary" }],
        true,
      ),
    ).toBe(true);
  });

  it("does not render Account when no account items and switcher is unavailable", () => {
    expect(
      shouldRenderNavGroup(
        "Account",
        [{ id: "discover", icon: "discover", label: "Discover", group: "Primary" }],
        false,
      ),
    ).toBe(false);
  });
});

describe("visibleNavItems", () => {
  const items = ALL.map((id) => ({
    id,
    icon: "discover" as const,
    label: id,
    group: "Primary" as const,
  }));

  it("returns all items when nothing is hidden", () => {
    expect(
      visibleNavItems(items, { serverMode: false, simpleMode: false }).map((i) => i.id),
    ).toEqual(ALL);
  });
  it("drops the Simple-mode-hidden items, preserving order", () => {
    const ids = visibleNavItems(items, { serverMode: false, simpleMode: true }).map(
      (i) => i.id,
    );
    expect(ids).not.toContain("assistant");
    expect(ids).not.toContain("debrid");
    expect(ids).not.toContain("calendar");
    expect(ids).toContain("discover");
    expect(ids).toContain("settings");
  });
});

describe("NavRail component", () => {
  beforeEach(() => {
    currentServerMode = false;
    currentSimpleMode = false;
    currentSession = null;
    currentProfiles = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders all groups and opens the mobile 'More' sheet", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<NavRail selected="discover" onSelect={onSelect} />);

    expect(screen.getByText("Primary", { selector: ".nav-rail-group-label" })).toBeInTheDocument();
    expect(
      screen.getByText("Library", { selector: ".nav-rail-group-label" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tools", { selector: ".nav-rail-group-label" })).toBeInTheDocument();
    expect(
      screen.getByText("Account", { selector: ".nav-rail-group-label" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More navigation" }));
    const moreSheet = screen
      .getByRole("button", { name: "Close more menu" })
      .closest(".nav-rail-more-sheet");
    expect(moreSheet).not.toBeNull();
    const withinMore = within(moreSheet!);
    expect(withinMore.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
    expect(withinMore.getByRole("button", { name: "History" })).toBeInTheDocument();

    const close = screen.getByRole("button", { name: "Close more menu" });
    expect(close).toBeInTheDocument();
    await user.click(close);
    expect(screen.queryByRole("button", { name: "Close more menu" })).not.toBeInTheDocument();
  });

  it("closes the overflow sheet via the background scrim", async () => {
    const user = userEvent.setup();
    render(<NavRail selected="discover" onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "More navigation" }));
    expect(screen.getByRole("button", { name: "Dismiss more menu" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss more menu" }));
    expect(screen.queryByRole("button", { name: "Dismiss more menu" })).toBeNull();
  });

  it("selecting an item from 'More' closes the overflow sheet and calls onSelect", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<NavRail selected="discover" onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "More navigation" }));
    const moreSheet = screen
      .getByRole("button", { name: "Close more menu" })
      .closest(".nav-rail-more-sheet");
    expect(moreSheet).not.toBeNull();
    const withinMore = within(moreSheet!);
    await user.click(withinMore.getByRole("button", { name: "Calendar" }));

    expect(onSelect).toHaveBeenCalledWith("calendar");
    expect(screen.queryByRole("button", { name: "Close more menu" })).not.toBeInTheDocument();
  });

  it("supports profile switching in Server Mode with profiles", async () => {
    const onSwitchProfile = vi.fn();
    currentServerMode = true;
    currentSession = {
      profileId: "p1",
      username: "owner",
      displayName: "Ada",
      role: "owner",
      avatarColor: "#ff8800",
      simpleMode: false,
    };
    currentProfiles = [
      {
        id: "p1",
        displayName: "Ada",
        avatarColor: "#ff8800",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Bran",
        avatarColor: "#0088ff",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    const user = userEvent.setup();
    render(
      <NavRail selected="discover" onSelect={vi.fn()} onSwitchProfile={onSwitchProfile} />,
    );

    await user.click(screen.getByRole("button", { name: /Switch profile \(current: ada\)/i }));
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /Switch profile \(current: ada\)/i }),
    ).toBeInTheDocument();
  });

  it("hides power-user tabs in simple mode while keeping settings visible", () => {
    currentSimpleMode = true;
    render(<NavRail selected="discover" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Discover" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calendar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the selected screen with aria-current page", () => {
    render(<NavRail selected="library" onSelect={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Library" });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(button.className).toContain("is-selected");
  });

  it("marks an overflow item as selected when the active screen is in More", async () => {
    const user = userEvent.setup();
    render(<NavRail selected="calendar" onSelect={vi.fn()} />);
    const more = screen.getByRole("button", { name: "More navigation" });
    expect(more.className).toContain("is-selected");
    await user.click(more);

    const moreSheet = screen
      .getByRole("button", { name: "Close more menu" })
      .closest(".nav-rail-more-sheet");
    expect(moreSheet).not.toBeNull();
    const withinMore = within(moreSheet!);
    const calendar = withinMore.getByRole("button", { name: "Calendar" });
    expect(calendar.className).toContain("is-selected");

    await user.click(screen.getByRole("button", { name: "Dismiss more menu" }));
    expect(screen.getByRole("button", { name: "More navigation" }).className).toContain("is-selected");
    expect(screen.queryByRole("button", { name: "Close more menu" })).not.toBeInTheDocument();
  });

  it("renders profile switch defaults when the session is not loaded yet", async () => {
    const onSwitchProfile = vi.fn();
    const user = userEvent.setup();
    currentServerMode = true;
    currentSession = null;
    currentProfiles = [
      {
        id: "p1",
        displayName: "First",
        avatarColor: "#ff8800",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Second",
        avatarColor: "#0088ff",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    render(
      <NavRail
        selected="discover"
        onSelect={vi.fn()}
        onSwitchProfile={onSwitchProfile}
      />,
    );

    const profile = screen.getByRole("button", { name: /Switch profile \(current: profile\)/i });
    expect(profile).toBeInTheDocument();
    expect(profile.querySelector(".nav-rail-profile-avatar")!).toHaveTextContent("?");
    expect(profile.querySelector(".nav-rail-profile-avatar")!).toHaveStyle({
      background: "#475569",
    });
    await user.click(profile);
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
  });

  it("skips active profile lookup when no session is loaded", () => {
    const onSwitchProfile = vi.fn();
    currentServerMode = true;
    currentSession = null;
    currentProfiles = [
      {
        id: "p1",
        displayName: "First",
        avatarColor: "#ff8800",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Second",
        avatarColor: "#0088ff",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    const findSpy = vi.spyOn(currentProfiles, "find");

    render(
      <NavRail selected="discover" onSelect={vi.fn()} onSwitchProfile={onSwitchProfile} />,
    );

    expect(findSpy).not.toHaveBeenCalled();
    const profile = screen.getByRole("button", { name: /Switch profile \(current:/i });
    const avatar = profile.querySelector(".nav-rail-profile-avatar");
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveTextContent("?");
  });

  it("uses a fallback initial for blank display names", () => {
    const onSwitchProfile = vi.fn();
    currentServerMode = true;
    currentSession = {
      profileId: "p1",
      username: "owner",
      displayName: "   ",
      role: "owner",
      avatarColor: "#aa0000",
      simpleMode: false,
    };
    currentProfiles = [
      {
        id: "p1",
        displayName: "   ",
        avatarColor: "#aa0000",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Second",
        avatarColor: "#00aa00",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    render(<NavRail selected="discover" onSelect={vi.fn()} onSwitchProfile={onSwitchProfile} />);

    const profile = screen.getByRole("button", {
      name: /Switch profile \(current:/i,
    });
    const avatar = profile.querySelector(".nav-rail-profile-avatar") as HTMLElement;
    expect(avatar).toHaveTextContent("?");
    expect(profile).toBeInTheDocument();
  });

  it("falls back to the default profile avatar when the session profile is missing from cache", () => {
    const onSwitchProfile = vi.fn();
    currentServerMode = true;
    currentSession = {
      profileId: "p3",
      username: "ghost",
      displayName: "Ghost",
      role: "member",
      avatarColor: "#aa0000",
      simpleMode: false,
    };
    currentProfiles = [
      {
        id: "p1",
        displayName: "Alice",
        avatarColor: "#11aa11",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Bob",
        avatarColor: "#2211aa",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    render(<NavRail selected="discover" onSelect={vi.fn()} onSwitchProfile={onSwitchProfile} />);

    const profile = screen.getByRole("button", { name: /Switch profile \(current: ghost\)/i });
    const avatar = profile.querySelector(".nav-rail-profile-avatar") as HTMLElement;
    expect(avatar).toHaveTextContent("G");
    expect(avatar).toHaveStyle({ background: "#475569" });
  });

  it("omits the Account group when server mode is active without a switch handler", () => {
    currentServerMode = true;
    currentSession = null;
    currentProfiles = [
      {
        id: "p1",
        displayName: "First",
        avatarColor: "#ff8800",
        simpleMode: false,
        isDefault: true,
        isKid: false,
      },
      {
        id: "p2",
        displayName: "Second",
        avatarColor: "#0088ff",
        simpleMode: false,
        isDefault: false,
        isKid: false,
      },
    ];
    render(<NavRail selected="discover" onSelect={vi.fn()} />);

    expect(screen.getByText("Account", { selector: ".nav-rail-group-label" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Switch profile/i }),
    ).toBeNull();
  });

  it("calls onSelect when a top-level nav button is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<NavRail selected="discover" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(onSelect).toHaveBeenCalledWith("search");
  });
});
