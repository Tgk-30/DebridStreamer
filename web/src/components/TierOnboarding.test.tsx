// @vitest-environment jsdom
//
// TierOnboarding: tier-aware welcome flow. These tests cover the three build
// profiles (family / friends / public) — their eyebrow label and step content —
// plus step navigation (Next/Back, dot active state, ambient loop per step) and
// the Skip / final "Get started" → onDone wiring.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TierOnboarding } from "./TierOnboarding";
import type { BuildProfile } from "../lib/ServerSessionContext";

// Drive the build profile per test.
const buildProfile = vi.fn<() => BuildProfile>(() => "public");
vi.mock("../lib/ServerSessionContext", () => ({
  useBuildProfile: () => buildProfile(),
}));

// Stub AmbientVideo with a marker that exposes the chosen loop name, so we can
// assert the per-step video without depending on the real <video> element.
vi.mock("./AmbientVideo", () => ({
  AmbientVideo: ({ name }: { name: string }) => (
    <div data-testid="ambient" data-name={name} />
  ),
}));

afterEach(() => {
  buildProfile.mockReturnValue("public");
  vi.clearAllMocks();
});

function ambientName(container: HTMLElement): string | null {
  return container.querySelector("[data-testid='ambient']")?.getAttribute("data-name") ?? null;
}

describe("TierOnboarding — public profile", () => {
  it("renders the dialog with the 'Get started' eyebrow and first step", () => {
    buildProfile.mockReturnValue("public");
    const { container } = render(<TierOnboarding onDone={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Welcome" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome to DebridStreamer",
    );
    expect(ambientName(container)).toBe("aurora");
  });

  it("renders three dots for the three-step public flow with the first active", () => {
    buildProfile.mockReturnValue("public");
    const { container } = render(<TierOnboarding onDone={() => {}} />);
    const dots = container.querySelectorAll(".tier-onboarding-dot");
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain("is-active");
    expect(dots[1].className).not.toContain("is-active");
  });

  it("does not render a Back button on the first step", () => {
    buildProfile.mockReturnValue("public");
    render(<TierOnboarding onDone={() => {}} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("TierOnboarding — family profile", () => {
  it("renders the 'Family' eyebrow and the two-step family flow", () => {
    buildProfile.mockReturnValue("family");
    const { container } = render(<TierOnboarding onDone={() => {}} />);
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome");
    expect(container.querySelectorAll(".tier-onboarding-dot")).toHaveLength(2);
  });
});

describe("TierOnboarding — friends profile", () => {
  it("renders the 'Your server' eyebrow and the three-step friends flow", () => {
    buildProfile.mockReturnValue("friends");
    const { container } = render(<TierOnboarding onDone={() => {}} />);
    expect(screen.getByText("Your server")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your server is ready",
    );
    expect(container.querySelectorAll(".tier-onboarding-dot")).toHaveLength(3);
  });
});

describe("TierOnboarding navigation", () => {
  it("advances through steps with Next, updating title, dot, and ambient loop", () => {
    buildProfile.mockReturnValue("public");
    const { container } = render(<TierOnboarding onDone={() => {}} />);

    // Step 0 -> "Next"
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bring your own keys",
    );
    expect(ambientName(container)).toBe("secure");
    const dots = container.querySelectorAll(".tier-onboarding-dot");
    expect(dots[1].className).toContain("is-active");

    // A Back button now appears.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    // Step 1 -> "Next" reaches the final step, which shows "Get started".
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You're set");
    expect(ambientName(container)).toBe("cinema");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("button", { name: "Get started" })).toBeInTheDocument();
  });

  it("goes back to the previous step with Back", () => {
    buildProfile.mockReturnValue("public");
    render(<TierOnboarding onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bring your own keys",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome to DebridStreamer",
    );
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("calls onDone when Skip is clicked", () => {
    buildProfile.mockReturnValue("public");
    const onDone = vi.fn();
    render(<TierOnboarding onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onDone when 'Get started' is clicked on the final step", () => {
    buildProfile.mockReturnValue("family");
    const onDone = vi.fn();
    render(<TierOnboarding onDone={onDone} />);
    // Family flow has two steps; advance once to reach the last.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not call onDone when Next is clicked on a non-final step", () => {
    buildProfile.mockReturnValue("public");
    const onDone = vi.fn();
    render(<TierOnboarding onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onDone).not.toHaveBeenCalled();
  });
});
