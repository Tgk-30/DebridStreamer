// @vitest-environment jsdom
//
// Component coverage for the Local Mode profile picker, focused on the lock
// screen's routing: with more than one profile the grid comes first so anyone
// can pick their own; with a single profile there is nothing to choose, so the
// unlock goes straight to its password (and offers no dead-end Back).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LocalProfile } from "../storage/ProfileRegistry";

const switchLocalProfile = vi.fn();
const refreshProfiles = vi.fn();
let profiles: LocalProfile[] = [];
let activeProfile: LocalProfile | null = null;

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ activeProfile, profiles, refreshProfiles, switchLocalProfile }),
}));

vi.mock("../storage/ProfileRegistry", () => ({
  createProfileRecord: vi.fn(),
}));

import { LocalProfilePicker } from "./LocalProfilePicker";

function profile(over: Partial<LocalProfile> = {}): LocalProfile {
  return {
    id: "default",
    name: "You",
    avatar: "😀",
    color: "#6366f1",
    isDefault: true,
    isAdmin: true,
    createdAt: 0,
    ...over,
  } as LocalProfile;
}

beforeEach(() => {
  switchLocalProfile.mockReset().mockResolvedValue({ ok: true });
  refreshProfiles.mockReset();
  profiles = [];
  activeProfile = null;
});

describe("LocalProfilePicker lock screen", () => {
  it("goes straight to the password when a single locked profile exists", async () => {
    const only = profile({ passwordHash: "pbkdf2:v1:x" });
    profiles = [only];
    activeProfile = only;

    render(<LocalProfilePicker mode="lock" onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Enter password" })).toBeInTheDocument();
    // No grid: there was nothing to choose between.
    expect(screen.queryByRole("button", { name: /You/ })).toBeNull();
    // ...and therefore no Back, which would strand the user on an empty grid.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("unlocks the sole profile with the typed password", async () => {
    const only = profile({ passwordHash: "pbkdf2:v1:x" });
    profiles = [only];
    activeProfile = only;
    const onClose = vi.fn();

    render(<LocalProfilePicker mode="lock" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Password/), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(switchLocalProfile).toHaveBeenCalledWith("default", "hunter2");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the selection grid first when several profiles exist", () => {
    const owner = profile({ passwordHash: "pbkdf2:v1:x" });
    const kid = profile({ id: "kid", name: "Kid", isDefault: false, isAdmin: false });
    profiles = [owner, kid];
    activeProfile = owner;

    render(<LocalProfilePicker mode="lock" onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Unlock a profile" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enter password" })).toBeNull();
    expect(screen.getByText(/^You/)).toBeInTheDocument();
    expect(screen.getByText("Kid")).toBeInTheDocument();
  });

  it("offers Back from the password form when a grid is behind it", async () => {
    const owner = profile({ passwordHash: "pbkdf2:v1:x" });
    const kid = profile({ id: "kid", name: "Kid", isDefault: false, isAdmin: false });
    profiles = [owner, kid];
    activeProfile = owner;

    render(<LocalProfilePicker mode="lock" onClose={() => {}} />);
    await userEvent.click(screen.getByText(/^You/));

    expect(screen.getByRole("heading", { name: "Enter password" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back returns to the choice, rather than trapping the user.
    expect(screen.getByRole("heading", { name: "Unlock a profile" })).toBeInTheDocument();
  });

  it("lets an unprotected profile through without a password", async () => {
    const owner = profile({ passwordHash: "pbkdf2:v1:x" });
    const kid = profile({ id: "kid", name: "Kid", isDefault: false, isAdmin: false });
    profiles = [owner, kid];
    activeProfile = owner;
    const onClose = vi.fn();

    render(<LocalProfilePicker mode="lock" onClose={onClose} />);
    await userEvent.click(screen.getByText("Kid"));

    expect(switchLocalProfile).toHaveBeenCalledWith("kid");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("still shows the grid in switch mode for a single profile", () => {
    // Switching is an explicit request to choose, so never auto-jump here.
    const only = profile({ passwordHash: "pbkdf2:v1:x" });
    profiles = [only];
    activeProfile = only;

    render(<LocalProfilePicker onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Who’s watching?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enter password" })).toBeNull();
  });
});
