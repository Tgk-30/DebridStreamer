// @vitest-environment jsdom
//
// HeroSpotlight: cinematic auto-rotating billboard. These tests cover the active
// item render, auto-advance interval, dot navigation, Play/More handlers, the
// backdrop preload effect (gated by smart-preload), and the empty/single guards.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { HeroSpotlight } from "./HeroSpotlight";
import type { MediaPreview } from "../models/media";

// Smart-preload preference - toggled per test via the mock fn's return value.
const isSmartPreloadEnabled = vi.fn(() => true);
vi.mock("../lib/smartPreload", () => ({
  isSmartPreloadEnabled: () => isSmartPreloadEnabled(),
}));

const items: MediaPreview[] = [
  { id: "a", type: "movie", title: "Alpha", year: 2001, imdbRating: 8.2, backdropPath: "/alpha.jpg" },
  { id: "b", type: "series", title: "Bravo", year: 2002, backdropPath: "/bravo.jpg" },
  { id: "c", type: "movie", title: "Charlie", backdropPath: "/charlie.jpg" },
];

beforeEach(() => {
  isSmartPreloadEnabled.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("HeroSpotlight rendering", () => {
  it("renders the first item as the active title with year and rating", () => {
    render(<HeroSpotlight items={items} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
    expect(screen.getByText("2001")).toBeInTheDocument();
    // imdbRating 8.2 -> "8.2" via ratingString
    expect(screen.getByText("8.2")).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });

  it("renders the active backdrop image with a w1280 TMDB URL", () => {
    const { container } = render(<HeroSpotlight items={items} />);
    const img = container.querySelector("img.hero-backdrop") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://image.tmdb.org/t/p/w1280/alpha.jpg");
  });

  it("renders a gradient placeholder when the active item has no backdrop", () => {
    const noBackdrop: MediaPreview = { id: "z", type: "movie", title: "Zulu" };
    const { container } = render(<HeroSpotlight item={noBackdrop} />);
    expect(container.querySelector("img.hero-backdrop")).toBeNull();
    expect(container.querySelector(".hero-backdrop.hero-gradient")).not.toBeNull();
  });

  it("renders the overview paragraph only when provided", () => {
    const { rerender, container } = render(<HeroSpotlight items={items} />);
    expect(container.querySelector(".hero-overview")).toBeNull();
    rerender(<HeroSpotlight items={items} overview="A thrilling ride." />);
    expect(screen.getByText("A thrilling ride.")).toBeInTheDocument();
  });

  it("omits the year/rating chips when the item lacks them", () => {
    // Charlie has no year and no imdbRating.
    const { container } = render(<HeroSpotlight item={items[2]} />);
    expect(container.querySelector(".hero-year")).toBeNull();
    expect(container.querySelector(".hero-rating")).toBeNull();
  });
});

describe("HeroSpotlight empty / single-item guards", () => {
  it("renders nothing when there are no items at all", () => {
    const { container } = render(<HeroSpotlight items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not render dot navigation for a single item", () => {
    const { container } = render(<HeroSpotlight item={items[0]} />);
    expect(container.querySelector(".hero-dots")).toBeNull();
  });

  it("renders dot navigation when there are multiple items", () => {
    const { container } = render(<HeroSpotlight items={items} />);
    expect(container.querySelector(".hero-dots")).not.toBeNull();
    // One dot button per item; the first is active.
    expect(container.querySelectorAll(".hero-dot")).toHaveLength(3);
    expect(container.querySelector(".hero-dot.is-active")).toBe(
      container.querySelectorAll(".hero-dot")[0],
    );
  });

  it("caps the rotation list at 6 items", () => {
    const many: MediaPreview[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      type: "movie",
      title: `Title ${i}`,
    }));
    const { container } = render(<HeroSpotlight items={many} />);
    expect(container.querySelectorAll(".hero-dot")).toHaveLength(6);
  });

  it("prefers items over the singular item prop when both are given", () => {
    const single: MediaPreview = { id: "single", type: "movie", title: "Single" };
    render(<HeroSpotlight items={items} item={single} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
  });
});

describe("HeroSpotlight auto-advance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("advances to the next item after the interval elapses", () => {
    render(<HeroSpotlight items={items} intervalMs={5000} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bravo");
  });

  it("wraps back to the first item after the last", () => {
    render(<HeroSpotlight items={items} intervalMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
  });

  it("does not auto-advance when there is only a single item", () => {
    render(<HeroSpotlight item={items[0]} intervalMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
  });
});

describe("HeroSpotlight dot navigation & hover pause", () => {
  it("jumps to a specific item when its dot is clicked", () => {
    const { container } = render(<HeroSpotlight items={items} />);
    const dots = container.querySelectorAll<HTMLButtonElement>(".hero-dot");
    fireEvent.click(dots[2]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Charlie");
    expect(dots[2].className).toContain("is-active");
  });

  it("marks only the active dot with is-active", () => {
    const { container } = render(<HeroSpotlight items={items} />);
    const dots = container.querySelectorAll<HTMLButtonElement>(".hero-dot");
    expect(dots[0].className).toContain("is-active");
    expect(dots[1].className).not.toContain("is-active");
  });

  it("pauses auto-advance on hover and resumes on leave", () => {
    vi.useFakeTimers();
    const { container } = render(<HeroSpotlight items={items} intervalMs={1000} />);
    const hero = container.querySelector(".hero") as HTMLElement;
    // Hover -> paused: no advance even after several intervals.
    act(() => {
      hero.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
    // Leave -> resumes.
    act(() => {
      hero.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bravo");
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});

describe("HeroSpotlight Play / More handlers", () => {
  it("calls onPlay with the active item", () => {
    const onPlay = vi.fn();
    render(<HeroSpotlight items={items} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
  });

  it("calls onDetails with the active item", () => {
    const onDetails = vi.fn();
    render(<HeroSpotlight items={items} onDetails={onDetails} />);
    fireEvent.click(screen.getByRole("button", { name: /More info/ }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onDetails).toHaveBeenCalledWith(items[0]);
  });

  it("does not throw when handlers are omitted", () => {
    render(<HeroSpotlight items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    fireEvent.click(screen.getByRole("button", { name: /More info/ }));
    // No assertion needed beyond not throwing.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
  });

  it("passes the currently active item (after navigation) to onPlay", () => {
    const onPlay = vi.fn();
    const { container } = render(<HeroSpotlight items={items} onPlay={onPlay} />);
    const dots = container.querySelectorAll<HTMLButtonElement>(".hero-dot");
    fireEvent.click(dots[1]);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onPlay).toHaveBeenCalledWith(items[1]);
  });
});

describe("HeroSpotlight backdrop preload effect", () => {
  let created: Array<{ src: string }>;
  let OriginalImage: typeof Image;

  beforeEach(() => {
    created = [];
    OriginalImage = globalThis.Image;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      constructor() {
        created.push(this as unknown as { src: string });
      }
      set src(v: string) {
        this._src = v;
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double for the global Image constructor.
    globalThis.Image = FakeImage;
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it("preloads the next backdrop when smart-preload is enabled", () => {
    isSmartPreloadEnabled.mockReturnValue(true);
    render(<HeroSpotlight items={items} />);
    // The preload effect creates an Image for the NEXT backdrop (index+1 -> bravo).
    const preloaded = created.find((c) => c.src.includes("/bravo.jpg"));
    expect(preloaded).toBeDefined();
    expect(preloaded!.src).toBe("https://image.tmdb.org/t/p/w1280/bravo.jpg");
  });

  it("detaches the preload Image src on cleanup", () => {
    isSmartPreloadEnabled.mockReturnValue(true);
    const { unmount } = render(<HeroSpotlight items={items} />);
    const preloaded = created.find((c) => c.src.includes("/bravo.jpg"));
    expect(preloaded).toBeDefined();
    unmount();
    // Cleanup sets src back to "" to abort the in-flight preload.
    expect(preloaded!.src).toBe("");
  });

  it("still preloads the next backdrop even when smart-preload is disabled", () => {
    // The next backdrop is a single image the carousel shows in ~7s regardless,
    // so it's preloaded unconditionally (same bytes, a beat earlier) - only the
    // expensive code-chunk preloads stay gated on smart-preload.
    isSmartPreloadEnabled.mockReturnValue(false);
    render(<HeroSpotlight items={items} />);
    expect(created.some((c) => c.src.includes("/bravo.jpg"))).toBe(true);
  });

  it("does not run the preload effect for a single item", () => {
    isSmartPreloadEnabled.mockReturnValue(true);
    render(<HeroSpotlight item={items[0]} />);
    // No "next backdrop" preload Image should be created (only the accent probe,
    // which uses the active /alpha.jpg, not a next-item backdrop).
    expect(created.some((c) => c.src.includes("/bravo.jpg"))).toBe(false);
  });

  it("preloads the following backdrop after advancing", () => {
    isSmartPreloadEnabled.mockReturnValue(true);
    const { container } = render(<HeroSpotlight items={items} />);
    created.length = 0;
    const dots = container.querySelectorAll<HTMLButtonElement>(".hero-dot");
    act(() => {
      dots[1].click();
    });
    // Active is now Bravo (index 1) -> next is Charlie (index 2).
    expect(created.some((c) => c.src.includes("/charlie.jpg"))).toBe(true);
  });
});

describe("HeroSpotlight per-title accent probe", () => {
  it("sets --title-accent-rgb from the dominant backdrop color on probe load", () => {
    // Drive a deterministic getImageData so extractDominantRGB returns a value.
    const vivid = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 200; // R high
      vivid[i + 1] = 40; // G low -> saturated, mid luminance
      vivid[i + 2] = 40; // B low
      vivid[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: vivid })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

    // Capture the probe Image so we can fire its onload manually.
    const OriginalImage = globalThis.Image;
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        // The accent probe sets crossOrigin before src; treat it as the probe.
        if (this.crossOrigin === "anonymous") probe = this as unknown as typeof probe;
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { container } = render(<HeroSpotlight item={items[0]} />);
      const hero = container.querySelector(".hero") as HTMLElement;
      expect(probe).not.toBeNull();
      act(() => {
        probe!.onload?.();
      });
      expect(hero.style.getPropertyValue("--title-accent-rgb")).not.toBe("");
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });
});
