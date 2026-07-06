// @vitest-environment jsdom
//
// HeroSpotlight: cinematic auto-rotating billboard. These tests cover the active
// item render, auto-advance interval, dot navigation, Play/More handlers, the
// backdrop preload effect (gated by smart-preload), and the empty/single guards.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { createElement, forwardRef } from "react";
import { HeroSpotlight } from "./HeroSpotlight";
import type { MediaPreview } from "../models/media";

// Smart-preload preference — toggled per test via the mock fn's return value.
const isSmartPreloadEnabled = vi.fn(() => true);
vi.mock("../lib/smartPreload", () => ({
  isSmartPreloadEnabled: () => isSmartPreloadEnabled(),
}));

// Replace motion with passthrough so AnimatePresence renders children
// synchronously (no exit-animation gating, no real-timer animation loops that
// would hang fake timers). We assert on real component behavior; the animation
// library is not under test.
vi.mock("motion/react", () => {
  const cache = new Map<string, unknown>();
  const makeTag = (tag: string) =>
    forwardRef(
      ({ children, ...props }: { children?: unknown }, ref: unknown) => {
        // Strip motion-only props that React would warn about on a DOM node.
        const {
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _t,
          ...rest
        } = props as Record<string, unknown>;
        void _i;
        void _a;
        void _e;
        void _t;
        return createElement(tag, { ...rest, ref }, children as never);
      },
    );
  const motion = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!cache.has(tag)) cache.set(tag, makeTag(tag));
        return cache.get(tag);
      },
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
  };
});

const items: MediaPreview[] = [
  { id: "a", type: "movie", title: "Alpha", year: 2001, imdbRating: 8.2, backdropPath: "/alpha.jpg" },
  { id: "b", type: "series", title: "Bravo", year: 2002, backdropPath: "/bravo.jpg" },
  { id: "c", type: "movie", title: "Charlie", backdropPath: "/charlie.jpg" },
];
const fallbackItem: MediaPreview = {
  id: "d",
  type: "movie",
  title: "Delta",
  backdropPath: "/delta.jpg",
};
const probeItem: MediaPreview = {
  id: "e",
  type: "movie",
  title: "Echo",
  backdropPath: "/echo.jpg",
};

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

  it("renders dot navigation with a count label when there are multiple items", () => {
    const { container } = render(<HeroSpotlight items={items} />);
    expect(container.querySelector(".hero-dots")).not.toBeNull();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    // One dot button per item.
    expect(container.querySelectorAll(".hero-dot")).toHaveLength(3);
  });

  it("caps the rotation list at 6 items", () => {
    const many: MediaPreview[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      type: "movie",
      title: `Title ${i}`,
    }));
    const { container } = render(<HeroSpotlight items={many} />);
    expect(container.querySelectorAll(".hero-dot")).toHaveLength(6);
    expect(screen.getByText("1/6")).toBeInTheDocument();
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
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("wraps back to the first item after the last", () => {
    render(<HeroSpotlight items={items} intervalMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
    expect(screen.getByText("1/3")).toBeInTheDocument();
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
    expect(screen.getByText("3/3")).toBeInTheDocument();
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

  it("pauses and resumes with React mouse handlers", () => {
    vi.useFakeTimers();
    const { container } = render(<HeroSpotlight items={items} intervalMs={1000} />);
    const hero = container.querySelector(".hero") as HTMLElement;
    fireEvent.mouseEnter(hero);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
    fireEvent.mouseLeave(hero);
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

  it("does not preload when smart-preload is disabled", () => {
    isSmartPreloadEnabled.mockReturnValue(false);
    render(<HeroSpotlight items={items} />);
    expect(created.some((c) => c.src.includes("/bravo.jpg"))).toBe(false);
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
  it("uses cached accent values when revisiting the same backdrop", () => {
    const vivid = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 200;
      vivid[i + 1] = 40;
      vivid[i + 2] = 40;
      vivid[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: vivid })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const OriginalImage = globalThis.Image;
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous") {
          probe = this as unknown as typeof probe;
        }
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { unmount, container } = render(<HeroSpotlight item={items[0]} />);
      expect(probe).not.toBeNull();
      act(() => {
        probe?.onload?.();
      });
      expect(container.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBeTruthy();

      unmount();
      probe = null;
      const { container: remounted } = render(<HeroSpotlight item={items[0]} />);
      expect(remounted.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBeTruthy();
      expect(probe).toBeNull();
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("falls back silently when dominant-color extraction throws", () => {
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => {
        throw new Error("No canvas");
      });
    const OriginalImage = globalThis.Image;
    const probes: Array<{ onload: (() => void) | null; src: string }> = [];
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous") {
          probe = this as unknown as typeof probe;
        }
      }
      get src() {
        return this._src;
      }
      constructor() {
        probes.push(this);
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { container, unmount } = render(<HeroSpotlight item={fallbackItem} />);
      expect(probe).not.toBeNull();
      act(() => {
        probe?.onload?.();
      });
      expect(container.querySelector(".hero")).not.toBeNull();
      expect(container.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBe("");
      unmount();

      probe = null;
      const { container: remounted } = render(<HeroSpotlight item={fallbackItem} />);
      expect(probes).toHaveLength(1);
      expect(remounted.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBe("");
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("uses the cached null accent path when extraction returns no vivid pixels", () => {
    const dull = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < dull.length; i += 4) {
      dull[i] = 1;
      dull[i + 1] = 1;
      dull[i + 2] = 1;
      dull[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: dull })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const OriginalImage = globalThis.Image;
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous") {
          probe = this as unknown as typeof probe;
        }
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { container, unmount } = render(<HeroSpotlight item={probeItem} />);
      expect(probe).not.toBeNull();
      act(() => {
        probe?.onload?.();
      });
      expect(container.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBe("");
      unmount();

      const { container: secondContainer } = render(<HeroSpotlight item={probeItem} />);
      expect(secondContainer.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBe("");
      expect(getContextSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("falls back when 2D canvas context is unavailable", () => {
    const OriginalImage = globalThis.Image;
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const created: Array<{ onload: (() => void) | null; src: string; crossOrigin: string }> = [];
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      constructor() {
        created.push(this);
      }
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous" && v.includes("/no-canvas.jpg")) {
          probe = this as unknown as typeof probe;
        }
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const item: MediaPreview = {
        id: "no-canvas",
        type: "movie",
        title: "No canvas",
        backdropPath: "/no-canvas.jpg",
      };
      const { container } = render(<HeroSpotlight item={item} />);
      expect(container.querySelector("img.hero-backdrop")).not.toBeNull();
      expect(probe).not.toBeNull();
      act(() => {
        probe?.onload?.();
      });
      expect(created).toHaveLength(1);
      const hero = container.querySelector(".hero") as HTMLElement;
      expect(hero.style.getPropertyValue("--title-accent-rgb")).toBe("");
      expect(getContextSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

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
    const probes: Array<{ onload: (() => void) | null; src: string; crossOrigin: string }> = [];
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      constructor() {
        probes.push(this);
      }
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
      const vividItem: MediaPreview = {
        id: "echo-vivid",
        type: "movie",
        title: "Echo vivid",
        backdropPath: "/echo-vivid.jpg",
      };
      const { container } = render(<HeroSpotlight item={vividItem} />);
      const resolvedProbe = probes.find(
        (candidate) =>
          candidate.crossOrigin === "anonymous" &&
          candidate.src.includes("https://image.tmdb.org/t/p/w1280/echo-vivid.jpg"),
      );
      if (resolvedProbe != null) {
        // Keep backward compatibility with the original `probe` reference and
        // reduce flakiness if a cached image is reused during future refactors.
        probe = resolvedProbe as typeof probe;
      }
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

  it("reaches the cached-color return branch when a cancelled probe callback fires", async () => {
    const vivid = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 200;
      vivid[i + 1] = 40;
      vivid[i + 2] = 40;
      vivid[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: vivid })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const OriginalImage = globalThis.Image;
    class FakeImage {
      crossOrigin = "";
      private _onload: (() => void) | null = null;
      private _src = "";
      set onload(v: (() => void) | null) {
        if (v !== null) {
          this._onload = v;
        }
      }
      get onload() {
        return this._onload;
      }
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous" && v.includes("/cancelled.jpg")) {
          const onload = this._onload;
          if (onload != null) {
            // Simulate a slow network that decodes after the component unmounts.
            Promise.resolve().then(() => onload());
          }
        }
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { unmount } = render(
        <HeroSpotlight item={{ id: "cancelled", type: "movie", title: "Cancelled", backdropPath: "/cancelled.jpg" }} />,
      );
      unmount();
      await Promise.resolve();
      expect(getContextSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("uses the saturating branch in extractDominantRGB when max channel is zero", () => {
    const dark = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < dark.length; i += 4) {
      dark[i] = 0;
      dark[i + 1] = 0;
      dark[i + 2] = 0;
      dark[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: dark })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const OriginalImage = globalThis.Image;
    let probe: { onload: (() => void) | null; src: string } | null = null;
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        if (this.crossOrigin === "anonymous" && v.includes("/all-zero.jpg")) {
          probe = this as unknown as typeof probe;
        }
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error -- test double.
    globalThis.Image = FakeImage;

    try {
      const { container } = render(
        <HeroSpotlight item={{ id: "dark", type: "movie", title: "Dark", backdropPath: "/all-zero.jpg" }} />,
      );
      expect(probe).not.toBeNull();
      act(() => {
        probe?.onload?.();
      });
      expect(container.querySelector(".hero")?.style.getPropertyValue("--title-accent-rgb")).toBe("");
      expect(getContextSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("evicts the oldest cached accent values when the accent cache is full", () => {
    const vivid = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 200;
      vivid[i + 1] = 40;
      vivid[i + 2] = 40;
      vivid[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: vivid })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

    const OriginalImage = globalThis.Image;
    type ProbeImage = {
      crossOrigin: string;
      onload: (() => void) | null;
      src: string;
    };
    const created: ProbeImage[] = [];

    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      constructor() {
        created.push(this);
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

    const probeFor = (url: string) => {
      for (let i = created.length - 1; i >= 0; i -= 1) {
        const candidate = created[i];
        if (candidate.crossOrigin === "anonymous" && candidate.src.includes(url)) {
          return candidate;
        }
      }
      return null;
    };

    try {
      const firstBackdropPath = "first-eviction-surface";
      const firstItem = {
        id: "cache-base",
        type: "movie" as const,
        title: "Cache Base",
        backdropPath: `/${firstBackdropPath}.jpg`,
      };
      {
        const { unmount } = render(<HeroSpotlight item={firstItem} />);
        const firstProbe = probeFor(`https://image.tmdb.org/t/p/w1280/${firstBackdropPath}.jpg`);
        expect(firstProbe).not.toBeNull();
        act(() => {
          firstProbe?.onload?.();
        });
        unmount();
      }

      for (let i = 0; i < 70; i += 1) {
        const unique = {
          id: `cache-${i}`,
          type: "movie" as const,
          title: `Cache ${i}`,
          backdropPath: `/cache-${i}.jpg`,
        };
        const { unmount } = render(<HeroSpotlight item={unique} />);
        const probe = probeFor(`https://image.tmdb.org/t/p/w1280/cache-${i}.jpg`);
        expect(probe).not.toBeNull();
        act(() => {
          probe?.onload?.();
        });
        unmount();
      }

      const callsBeforeRevisit = getContextSpy.mock.calls.length;
      const { container } = render(<HeroSpotlight item={firstItem} />);
      const revisitProbe = probeFor(`https://image.tmdb.org/t/p/w1280/${firstBackdropPath}.jpg`);
      if (revisitProbe != null) {
        act(() => {
          revisitProbe.onload?.();
        });
      }
      expect(getContextSpy.mock.calls.length).toBeGreaterThan(callsBeforeRevisit);
      expect(container.querySelector(".hero")).not.toBeNull();
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
    }
  });

  it("does not delete cache entry when oldest is missing even with a full accent cache", () => {
    const vivid = new Uint8ClampedArray(24 * 14 * 4);
    for (let i = 0; i < vivid.length; i += 4) {
      vivid[i] = 200;
      vivid[i + 1] = 40;
      vivid[i + 2] = 40;
      vivid[i + 3] = 255;
    }
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: vivid })),
    };
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

    const OriginalImage = globalThis.Image;
    type ProbeImage = {
      crossOrigin: string;
      onload: (() => void) | null;
      src: string;
    };
    const created: ProbeImage[] = [];
    class FakeImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      private _src = "";
      constructor() {
        created.push(this);
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

    const probeFor = (url: string) => {
      for (let i = created.length - 1; i >= 0; i -= 1) {
        const candidate = created[i];
        if (candidate.crossOrigin === "anonymous" && candidate.src.includes(url)) {
          return candidate;
        }
      }
      return null;
    };
    let deleteSpy: ReturnType<typeof vi.spyOn> | null = null;
    let keysSpy: ReturnType<typeof vi.spyOn> | null = null;

    try {
      for (let i = 0; i < 70; i += 1) {
        const prefill = {
          id: `prefill-${i}`,
          type: "movie" as const,
          title: `Prefill ${i}`,
          backdropPath: `/prefill-${i}.jpg`,
        };
        const { unmount } = render(<HeroSpotlight item={prefill} />);
        const probe = probeFor(`https://image.tmdb.org/t/p/w1280/prefill-${i}.jpg`);
        expect(probe).not.toBeNull();
        act(() => {
          probe?.onload?.();
        });
        unmount();
      }

      const target = {
        id: "missing-oldest",
        type: "movie" as const,
        title: "Missing oldest",
        backdropPath: "/missing-oldest.jpg",
      };
      const callsBeforeRevisit = getContextSpy.mock.calls.length;
      deleteSpy = vi.spyOn(Map.prototype, "delete");
      keysSpy = vi.spyOn(Map.prototype, "keys").mockImplementation(function () {
        let called = false;
        return {
          next: () => {
            if (called) return { done: true, value: undefined };
            called = true;
            return { done: false, value: undefined };
          },
          [Symbol.iterator]() {
            return this as IterableIterator<unknown>;
          },
        } as unknown as IterableIterator<string>;
      });
      {
        const { unmount } = render(<HeroSpotlight item={target} />);
        const firstProbe = probeFor("https://image.tmdb.org/t/p/w1280/missing-oldest.jpg");
        expect(firstProbe).not.toBeNull();
        act(() => {
          firstProbe?.onload?.();
        });
        unmount();
      }
      expect(deleteSpy).not.toHaveBeenCalledWith(undefined);
      expect(getContextSpy).toHaveBeenCalledTimes(callsBeforeRevisit + 1);

      const { container } = render(<HeroSpotlight item={target} />);
      expect(container.querySelector(".hero")).not.toBeNull();
      expect(getContextSpy).toHaveBeenCalledTimes(callsBeforeRevisit + 1);
    } finally {
      globalThis.Image = OriginalImage;
      getContextSpy.mockRestore();
      deleteSpy?.mockRestore();
      keysSpy?.mockRestore();
    }
  });
});
