// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { SpotlightTour, type TourStep } from "./SpotlightTour";

// jsdom has no layout engine, so getBoundingClientRect returns zeros. Stub it on
// the tour targets so the component can measure a real spotlight rect.
function anchor(screenId: string, rect: Partial<DOMRect>) {
  const el = document.createElement("button");
  el.setAttribute("data-screen", screenId);
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

const STEPS: TourStep[] = [
  { target: '[data-screen="discover"]', title: "Home base", body: "Browse." },
  { target: '[data-screen="settings"]', title: "Your keys", body: "Configure." },
];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SpotlightTour", () => {
  it("spotlights the first target and advances through steps, then finishes", () => {
    anchor("discover", { top: 100, left: 12, width: 180, height: 44 });
    anchor("settings", { top: 620, left: 12, width: 180, height: 44 });
    // Drive rAF synchronously so the measure commits within act().
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const onDone = vi.fn();

    act(() => {
      render(<SpotlightTour steps={STEPS} onDone={onDone} />);
    });

    // Step 1: title + a measured cutout (not the fallback scrim).
    expect(screen.getByText("Home base")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    const cutout = document.querySelector(".tour-cutout") as HTMLElement;
    expect(cutout).not.toBeNull();
    // top = rect.top - PAD(8) = 92; left = 12 - 8 = 4.
    expect(cutout.style.top).toBe("92px");
    expect(cutout.style.left).toBe("4px");
    expect(document.querySelector(".tour-scrim")).toBeNull();

    // Advance → step 2 targets settings.
    act(() => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(screen.getByText("Your keys")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    const cutout2 = document.querySelector(".tour-cutout") as HTMLElement;
    expect(cutout2.style.top).toBe("612px"); // 620 - 8

    // Last step's button is "Done" → finishes.
    act(() => {
      fireEvent.click(screen.getByText("Done"));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("falls back to a centered scrim when the target is absent", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    act(() => {
      render(<SpotlightTour steps={STEPS} onDone={() => {}} />);
    });
    // No anchors in the DOM → no cutout, a dismiss scrim instead.
    expect(document.querySelector(".tour-cutout")).toBeNull();
    expect(document.querySelector(".tour-scrim")).not.toBeNull();
  });

  it("skips immediately via the Skip button", () => {
    anchor("discover", { top: 100, left: 12, width: 180, height: 44 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const onDone = vi.fn();
    act(() => {
      render(<SpotlightTour steps={STEPS} onDone={onDone} />);
    });
    act(() => {
      fireEvent.click(screen.getByText("Skip tour"));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
