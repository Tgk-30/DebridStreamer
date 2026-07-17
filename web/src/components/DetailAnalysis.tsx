// DetailAnalysis - the AI "Will I Like This?" card on the Detail screen.
//
// Shown only when an AI provider is configured (the parent gates on it). It
// offers a single "Will I like this?" button; on click it builds the user's
// taste-profile context, calls provider.analyzeTitle(...), and renders a
// verdict-tinted glass card: a big predicted X/10, a verdict pill, the
// personalized blurb, and 2-4 bullet reasons. Loading + error states are inline.
//
// Mirrors VPStudio's DetailAIAnalysis view. Each successful call also persists a
// local AI usage record (token/cost estimate) into the Store.

import { useState } from "react";
import type { MediaItem } from "../models/media";
import type {
  AIAssistantProvider,
  AIPersonalizedAnalysis,
  AIPersonalizedVerdict,
} from "../services/ai/types";
import { buildTasteContext } from "../services/ai/TasteProfile";
import { getStore } from "../storage";
import type { AIUsageRecord } from "../storage/models";
import { Icon } from "./Icon";
import "./DetailAnalysis.css";

interface DetailAnalysisProps {
  item: MediaItem;
  provider: AIAssistantProvider;
}

/** Human-facing verdict labels. */
const VERDICT_LABEL: Record<AIPersonalizedVerdict, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "Probably not",
  strong_no: "Skip it",
};

/** The CSS tone class per verdict (greens / amber / reds). */
function verdictTone(verdict: AIPersonalizedVerdict): string {
  switch (verdict) {
    case "strong_yes":
    case "yes":
      return "tone-yes";
    case "maybe":
      return "tone-maybe";
    case "no":
    case "strong_no":
      return "tone-no";
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function DetailAnalysis({ item, provider }: DetailAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AIPersonalizedAnalysis | null>(null);

  // analyzeTitle is optional on the interface; without it there's nothing to do.
  if (provider.analyzeTitle == null) return null;
  const analyze = provider.analyzeTitle.bind(provider);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const store = getStore();
      const tasteContext = await buildTasteContext(store).catch(() => "");
      const result = await analyze({
        title: item.title,
        year: item.year,
        type: item.type,
        genres: item.genres,
        overview: item.overview,
        tasteContext,
      });
      setAnalysis(result.analysis);

      // Persist a local usage record (best-effort; never blocks the UI).
      const usage = result.usage;
      const record: AIUsageRecord = {
        id: `aiuse-${uuid()}`,
        provider: provider.kind,
        model: result.model,
        feature: "analyze",
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        estimatedCostUSD: usage?.estimatedCostUSD ?? null,
        createdAt: new Date().toISOString(),
      };
      void store.addAIUsage(record).catch(() => {
        // best-effort ledger; ignore write failures.
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="detail-analysis">
      {analysis != null ? (
          <div
            key="result"
            className={`detail-analysis-card detail-analysis-in glass-raised glass-lit ${verdictTone(
              analysis.verdict,
            )}`}
          >
            <div className="detail-analysis-head">
              <div className="detail-analysis-score" aria-hidden="true">
                <span className="detail-analysis-score-num">
                  {analysis.predictedRating}
                </span>
                <span className="detail-analysis-score-den">/10</span>
              </div>
              <div className="detail-analysis-headtext">
                <span className="detail-analysis-eyebrow">Will I like this?</span>
                <span className="detail-analysis-verdict">
                  {VERDICT_LABEL[analysis.verdict]}
                </span>
              </div>
              <button
                type="button"
                className="detail-analysis-close"
                onClick={() => setAnalysis(null)}
                aria-label="Dismiss analysis"
                title="Dismiss"
              >
                <Icon name="xmark" size={15} />
              </button>
            </div>

            {analysis.personalizedDescription.length > 0 && (
              <p className="detail-analysis-blurb">
                {analysis.personalizedDescription}
              </p>
            )}

            {analysis.reasons.length > 0 && (
              <ul className="detail-analysis-reasons">
                {analysis.reasons.map((reason, i) => (
                  <li key={reason + i}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        ) : loading ? (
          <div
            key="loading"
            className="detail-analysis-status detail-analysis-fade-in"
          >
            <span className="detail-analysis-spinner" aria-hidden />
            <span className="t-secondary">
              Analyzing based on your taste profile…
            </span>
          </div>
        ) : error != null ? (
          <div
            key="error"
            className="detail-analysis-status detail-analysis-error detail-analysis-fade-in"
          >
            <Icon name="info" size={15} className="t-warning" />
            <span className="t-secondary">{error}</span>
            <button
              type="button"
              className="detail-analysis-retry"
              onClick={() => void run()}
            >
              Try again
            </button>
          </div>
        ) : (
          <button
            key="cta"
            type="button"
            className="detail-analysis-cta detail-analysis-fade-in chip"
            onClick={() => void run()}
          >
            <Icon name="sparkles" size={15} className="t-accent" />
            Will I like this?
          </button>
        )}
    </div>
  );
}
