// @vitest-environment jsdom
//
// Render/interaction tests for the Assistant screen - a one-shot AI recommend
// call. Without an AI provider (and not in Server Mode) it shows a configure
// state; otherwise submitting a prompt calls provider.recommend (local) or
// recommendServerAI (server) and renders the title/year/reason/score cards.
//
// Mocked deps: the app store (services.ai + navigate), serverMode, serverApi
// (recommendServerAI). The provider is a plain object with a recommend spy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AIMovieRecommendation,
  AIProviderRecommendationResult,
} from "../services/ai/models";

// --- mutable mock state -----------------------------------------------------

const navigate = vi.fn();
const recommend = vi.fn();
const recommendServerAI = vi.fn();
let mockProvider: { recommend: typeof recommend } | null;
let mockServerMode = false;

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    services: { ai: mockProvider },
    navigate,
  }),
}));

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));

vi.mock("../lib/serverApi", () => ({
  recommendServerAI: (input: { prompt: string; count: number }) =>
    recommendServerAI(input),
}));

import { Assistant } from "./Assistant";

// --- helpers ----------------------------------------------------------------

function rec(
  title: string,
  score: number,
  p: Partial<AIMovieRecommendation> = {},
): AIMovieRecommendation {
  return {
    title,
    year: p.year ?? null,
    reason: p.reason ?? `because ${title}`,
    score,
    mediaId: null,
    mediaType: null,
    posterPath: null,
  };
}

function result(recs: AIMovieRecommendation[]): AIProviderRecommendationResult {
  return { model: "test", recommendations: recs, rawText: null, usage: null };
}

beforeEach(() => {
  navigate.mockClear();
  recommend.mockReset();
  recommendServerAI.mockReset();
  mockProvider = { recommend };
  mockServerMode = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Assistant - gated state", () => {
  it("shows the configure state when no provider and not server mode", async () => {
    mockProvider = null;
    mockServerMode = false;
    render(<Assistant />);
    expect(screen.getByText("Configure an AI provider")).toBeInTheDocument();
    expect(screen.queryByLabelText("Describe what to watch")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("renders the prompt UI in Server Mode even without a local provider", () => {
    mockProvider = null;
    mockServerMode = true;
    render(<Assistant />);
    expect(screen.getByLabelText("Describe what to watch")).toBeInTheDocument();
  });
});

describe("Assistant - recommend flow (local provider)", () => {
  it("disables Recommend until the prompt is non-empty", async () => {
    render(<Assistant />);
    const btn = screen.getByRole("button", { name: "Recommend" });
    expect(btn).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Describe what to watch"),
      "heist",
    );
    expect(btn).toBeEnabled();
  });

  it("submits the prompt and renders the recommendation cards", async () => {
    recommend.mockResolvedValue(
      result([
        rec("Inception", 0.92, { year: 2010, reason: "dreams within dreams" }),
        rec("Primer", 0.81),
      ]),
    );
    render(<Assistant />);
    await userEvent.type(
      screen.getByLabelText("Describe what to watch"),
      "sci-fi",
    );
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));

    expect(await screen.findByText("Inception")).toBeInTheDocument();
    expect(recommend).toHaveBeenCalledWith("sci-fi", [], 8);
    // year + reason + rounded score percent.
    expect(screen.getByText("2010")).toBeInTheDocument();
    expect(screen.getByText("dreams within dreams")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("81%")).toBeInTheDocument();
  });

  it("returns early when the prompt is blank", async () => {
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "{Enter}");
    expect(recommend).not.toHaveBeenCalled();
  });

  it("submits on Enter key", async () => {
    recommend.mockResolvedValue(result([rec("Drive", 0.7)]));
    render(<Assistant />);
    const input = screen.getByLabelText("Describe what to watch");
    await userEvent.type(input, "neo-noir{Enter}");
    expect(await screen.findByText("Drive")).toBeInTheDocument();
    expect(recommend).toHaveBeenCalledWith("neo-noir", [], 8);
  });

  it("clicking a suggestion chip fills the prompt and runs a recommend", async () => {
    recommend.mockResolvedValue(result([rec("Arrival", 0.88)]));
    render(<Assistant />);
    await userEvent.click(
      screen.getByRole("button", { name: "Mind-bending sci-fi from the 2010s" }),
    );
    expect(await screen.findByText("Arrival")).toBeInTheDocument();
    expect(recommend).toHaveBeenCalledWith(
      "Mind-bending sci-fi from the 2010s",
      [],
      8,
    );
  });

  it("shows the empty-results message when nothing comes back", async () => {
    recommend.mockResolvedValue(result([]));
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(
      await screen.findByText(/No recommendations came back/i),
    ).toBeInTheDocument();
  });

  it("surfaces the error and shows no results on failure", async () => {
    recommend.mockRejectedValue(new Error("rate limited"));
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByText("rate limited")).toBeInTheDocument();
    expect(screen.queryByText(/No recommendations came back/i)).not.toBeInTheDocument();
  });

  it("stringifies non-Error failures", async () => {
    recommend.mockRejectedValue("plain failure");
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByText("plain failure")).toBeInTheDocument();
  });

  it("shows a Thinking… label while the call is in flight", async () => {
    let resolve!: (v: AIProviderRecommendationResult) => void;
    recommend.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    resolve(result([rec("Coherence", 0.6)]));
    await screen.findByText("Coherence");
  });
});

describe("Assistant - server mode routing", () => {
  it("routes to recommendServerAI (not the local provider) in Server Mode", async () => {
    mockProvider = null;
    mockServerMode = true;
    recommendServerAI.mockResolvedValue(result([rec("Tenet", 0.77)]));
    render(<Assistant />);
    await userEvent.type(
      screen.getByLabelText("Describe what to watch"),
      "time",
    );
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByText("Tenet")).toBeInTheDocument();
    expect(recommendServerAI).toHaveBeenCalledWith({ prompt: "time", count: 8 });
    expect(recommend).not.toHaveBeenCalled();
  });

  it("recommendation card omits the year when null", async () => {
    recommend.mockResolvedValue(result([rec("Untitled", 0.5)]));
    render(<Assistant />);
    await userEvent.type(screen.getByLabelText("Describe what to watch"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    const card = (await screen.findByText("Untitled")).closest(".assistant-rec");
    expect(card).not.toBeNull();
    // no year span rendered (50% score still present)
    expect(within(card as HTMLElement).getByText("50%")).toBeInTheDocument();
  });
});
