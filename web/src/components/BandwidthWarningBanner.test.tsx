// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let serverMode = true;
let session: { profileId: string; role: string } | null = null;
let profiles: Array<Record<string, unknown>> = [];

vi.mock("../lib/serverMode", () => ({ isServerMode: () => serverMode }));
vi.mock("../lib/ServerSessionContext", () => ({
  useServerSession: () => session,
  useServerProfiles: () => profiles,
}));

import { BandwidthWarningBanner } from "./BandwidthWarningBanner";

function active(status: "ok" | "approaching" | "over") {
  session = { profileId: "p1", role: "member" };
  profiles = [
    {
      id: "p1",
      bandwidthCapBytes: 1024 ** 3,
      bandwidthUsageBytes: status === "over" ? 1024 ** 3 : 0.8 * 1024 ** 3,
      bandwidthStatus: status,
    },
  ];
}

describe("BandwidthWarningBanner", () => {
  it("shows approaching usage for the active member profile and can be dismissed", async () => {
    const user = userEvent.setup();
    active("approaching");
    render(<BandwidthWarningBanner />);

    expect(screen.getByText(/You have used .* of your .* monthly cap/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss bandwidth warning" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the explicit over-cap reassurance", () => {
    active("over");
    render(<BandwidthWarningBanner />);
    expect(
      screen.getByText("You are over your monthly cap - playback still works; your household owner can adjust it."),
    ).toBeInTheDocument();
  });

  it("does not show for ok status", () => {
    active("ok");
    render(<BandwidthWarningBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
