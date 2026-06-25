// @vitest-environment jsdom
//
// Render/behavior tests for DetailAnalysis: the analyzeTitle gate (null render),
// the CTA -> loading -> result happy path (score, verdict pill, blurb, reasons,
// tone class), the empty-blurb/empty-reasons conditionals, dismissing a result,
// the error state + Try again retry, and the best-effort usage-record write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaItem } from "../models/media";
import type {
  AIAssistantProvider,
  AIProviderAnalysisResult,
} from "../services/ai/types";

// motion/react: render the animated elements as their plain DOM tags so the
// component tree is assertable and AnimatePresence doesn't defer mounts.
vi.mock("motion/react", () => {
  const passthrough = (Tag: string) => (props: Record<string, unknown>) => {
    // Drop motion-only props that React would warn about on a DOM node.
    const {
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...rest
    } = props;
    return <Tag {...rest} />;
  };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => passthrough(tag),
      },
    ),
  };
});

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// TasteProfile.buildTasteContext is awaited (with a .catch) before analyze.
const buildTasteContext = vi.fn<() => Promise<string>>();
vi.mock("../services/ai/TasteProfile", () => ({
  buildTasteContext: () => buildTasteContext(),
}));

// Store: only addAIUsage is touched by the component.
const addAIUsage = vi.fn<(r: unknown) => Promise<void>>();
vi.mock("../storage", () => ({
  getStore: () => ({ addAIUsage }),
}));

import { DetailAnalysis } from "./DetailAnalysis";

const item: MediaItem = {
  id: "m1",
  type: "movie",
  title: "Inception",
  year: 2010,
  genres: ["Sci-Fi", "Thriller"],
  overview: "A thief who steals secrets through dreams.",
  lastFetched: "2024-01-01T00:00:00.000Z",
};

function makeProvider(
  analyzeTitle?: AIAssistantProvider["analyzeTitle"],
): AIAssistantProvider {
  return {
    kind: "openai",
    recommend: vi.fn(),
    analyzeTitle,
  };
}

function result(
  overrides: Partial<AIProviderAnalysisResult["analysis"]> = {},
  usage: AIProviderAnalysisResult["usage"] = {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCostUSD: 0.01,
  },
): AIProviderAnalysisResult {
  return {
    model: "gpt-4.1",
    rawText: "{}",
    usage,
    analysis: {
      personalizedDescription: "You'll love the layered heist structure.",
      predictedRating: 9,
      verdict: "strong_yes",
      reasons: ["Twisty plot", "Great score"],
      ...overrides,
    },
  };
}

beforeEach(() => {
  buildTasteContext.mockResolvedValue("likes sci-fi");
  addAIUsage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DetailAnalysis", () => {
  it("renders nothing when the provider has no analyzeTitle", () => {
    const { container } = render(
      <DetailAnalysis item={item} provider={makeProvider(undefined)} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the CTA initially and runs analysis on click", async () => {
    const analyzeTitle = vi.fn().mockResolvedValue(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();

    const cta = screen.getByRole("button", { name: /Would I like this\?/ });
    expect(cta).toBeInTheDocument();

    await user.click(cta);

    // Result renders: score, /10, verdict label, blurb, reasons.
    await screen.findByText("9");
    expect(screen.getByText("/10")).toBeInTheDocument();
    expect(screen.getByText("Strong yes")).toBeInTheDocument();
    expect(
      screen.getByText("You'll love the layered heist structure."),
    ).toBeInTheDocument();
    expect(screen.getByText("Twisty plot")).toBeInTheDocument();
    expect(screen.getByText("Great score")).toBeInTheDocument();

    // analyze called with the item fields + the built taste context.
    expect(analyzeTitle).toHaveBeenCalledWith({
      title: "Inception",
      year: 2010,
      type: "movie",
      genres: ["Sci-Fi", "Thriller"],
      overview: "A thief who steals secrets through dreams.",
      tasteContext: "likes sci-fi",
    });
  });

  it("applies the verdict tone class on the result card", async () => {
    const analyzeTitle = vi
      .fn()
      .mockResolvedValue(result({ verdict: "no", predictedRating: 3 }));
    const { container } = render(
      <DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Probably not");
    expect(container.querySelector(".detail-analysis-card.tone-no")).not.toBeNull();
  });

  it("maps the 'maybe' verdict to its tone and label", async () => {
    const analyzeTitle = vi
      .fn()
      .mockResolvedValue(result({ verdict: "maybe", predictedRating: 6 }));
    const { container } = render(
      <DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Maybe");
    expect(
      container.querySelector(".detail-analysis-card.tone-maybe"),
    ).not.toBeNull();
  });

  it("omits the blurb and reasons when they are empty", async () => {
    const analyzeTitle = vi.fn().mockResolvedValue(
      result({ personalizedDescription: "", reasons: [] }),
    );
    const { container } = render(
      <DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Strong yes");
    expect(container.querySelector(".detail-analysis-blurb")).toBeNull();
    expect(container.querySelector(".detail-analysis-reasons")).toBeNull();
  });

  it("dismisses the result back to the CTA via the close button", async () => {
    const analyzeTitle = vi.fn().mockResolvedValue(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Strong yes");
    await user.click(screen.getByRole("button", { name: "Dismiss analysis" }));

    // Back to the CTA; the result card is gone.
    expect(
      screen.getByRole("button", { name: /Would I like this\?/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Strong yes")).toBeNull();
  });

  it("shows the loading state while analyze is pending", async () => {
    let resolve!: (r: AIProviderAnalysisResult) => void;
    const analyzeTitle = vi.fn(
      () => new Promise<AIProviderAnalysisResult>((r) => (resolve = r)),
    );
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Analyzing based on your taste profile…");
    // Resolve and confirm we land on the result.
    resolve(result());
    await screen.findByText("Strong yes");
  });

  it("shows the error message + Try again when analyze rejects", async () => {
    const analyzeTitle = vi
      .fn()
      .mockRejectedValue(new Error("provider down"));
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("provider down");
    expect(document.querySelector('[data-icon="info"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("Try again re-invokes analyze and can then succeed", async () => {
    const analyzeTitle = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("transient");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(analyzeTitle).toHaveBeenCalledTimes(2);
    await screen.findByText("Strong yes");
  });

  it("stringifies a non-Error rejection in the error state", async () => {
    const analyzeTitle = vi.fn().mockRejectedValue("string failure");
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("string failure");
  });

  it("persists a usage record on success with the provider kind and model", async () => {
    const analyzeTitle = vi.fn().mockResolvedValue(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Strong yes");
    await waitFor(() => expect(addAIUsage).toHaveBeenCalledTimes(1));

    const record = addAIUsage.mock.calls[0][0] as Record<string, unknown>;
    expect(record).toMatchObject({
      provider: "openai",
      model: "gpt-4.1",
      feature: "analyze",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUSD: 0.01,
    });
    expect(typeof record.id).toBe("string");
    expect(record.id as string).toMatch(/^aiuse-/);
    expect(typeof record.createdAt).toBe("string");
  });

  it("records nulls when usage is absent and still shows the result", async () => {
    const analyzeTitle = vi.fn().mockResolvedValue(result({}, null));
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Strong yes");
    await waitFor(() => expect(addAIUsage).toHaveBeenCalledTimes(1));
    const record = addAIUsage.mock.calls[0][0] as Record<string, unknown>;
    expect(record.inputTokens).toBeNull();
    expect(record.outputTokens).toBeNull();
    expect(record.totalTokens).toBeNull();
    expect(record.estimatedCostUSD).toBeNull();
  });

  it("uses an empty taste context when buildTasteContext rejects", async () => {
    buildTasteContext.mockRejectedValue(new Error("no profile"));
    const analyzeTitle = vi.fn().mockResolvedValue(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    await screen.findByText("Strong yes");
    expect(analyzeTitle).toHaveBeenCalledWith(
      expect.objectContaining({ tasteContext: "" }),
    );
  });

  it("still renders the result even when the usage write fails", async () => {
    addAIUsage.mockRejectedValue(new Error("db write failed"));
    const analyzeTitle = vi.fn().mockResolvedValue(result());
    render(<DetailAnalysis item={item} provider={makeProvider(analyzeTitle)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Would I like this\?/ }));

    // The best-effort write rejection is swallowed; the card stays.
    await screen.findByText("Strong yes");
  });
});
