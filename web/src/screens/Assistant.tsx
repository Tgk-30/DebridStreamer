// Assistant screen — a one-shot AI recommend call wired to a ported provider.
//
// When an AI provider is configured (Settings → AI), submitting a prompt calls
// provider.recommend(...) and renders the returned recommendations (title · year
// · reason · score). Without a key it shows a clear "configure an AI provider"
// state. The provider is built read-only from settings (services.ai). The DB-
// backed context assembler / candidate enrichment is deferred to the storage
// port — we pass an empty candidate set, which the provider handles.

import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import type { AIMovieRecommendation } from "../services/ai/models";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import "./Assistant.css";

const SUGGESTIONS = [
  "Mind-bending sci-fi from the 2010s",
  "Cozy mysteries for a rainy night",
  "Underrated heist thrillers",
  "Feel-good animated movies",
];

export function Assistant() {
  const { services, navigate } = useAppStore();

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AIMovieRecommendation[] | null>(null);

  const provider = services.ai;

  async function recommend(text: string) {
    const q = text.trim();
    if (q.length === 0 || provider == null) return;
    setLoading(true);
    setError(null);
    try {
      const result = await provider.recommend(q, [], 8);
      setResults(result.recommendations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  if (provider == null) {
    return (
      <div className="assistant-screen">
        <h1 className="assistant-h1">AI Assistant</h1>
        <EmptyState
          icon="assistant"
          title="Configure an AI provider"
          subtitle="Add an AI provider in Settings to turn mood prompts into focused watch recommendations."
          actions={
            <button
              type="button"
              className="btn btn-prominent"
              onClick={() => navigate("settings")}
            >
              <Icon name="settings" size={15} />
              Open settings
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="assistant-screen">
      <h1 className="assistant-h1">AI Assistant</h1>
      <p className="assistant-sub t-secondary">
        Describe what you're in the mood for and the assistant will suggest a
        lineup.
      </p>

      <div className="assistant-prompt glass-raised glass-lit field">
        <Icon name="wand-search" size={18} className="t-accent" />
        <input
          type="text"
          placeholder="e.g. slow-burn psychological thrillers"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void recommend(prompt);
          }}
          aria-label="Describe what to watch"
        />
        <button
          type="button"
          className="btn btn-prominent"
          disabled={prompt.trim().length === 0 || loading}
          onClick={() => void recommend(prompt)}
        >
          {loading ? "Thinking…" : "Recommend"}
        </button>
      </div>

      <div className="assistant-chips">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => {
              setPrompt(s);
              void recommend(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="assistant-error">{error}</p>}

      {results != null && (
        <section className="assistant-results">
          {results.length === 0 ? (
            <p className="t-secondary">No recommendations came back. Try rephrasing.</p>
          ) : (
            results.map((rec) => (
              <div
                key={`${rec.title}-${rec.year ?? 0}`}
                className="assistant-rec glass-rest glass-lit"
              >
                <div className="assistant-rec-head">
                  <span className="assistant-rec-title">{rec.title}</span>
                  {rec.year != null && (
                    <span className="assistant-rec-year t-secondary">
                      {rec.year}
                    </span>
                  )}
                  <span className="assistant-rec-score">
                    {Math.round(rec.score * 100)}%
                  </span>
                </div>
                <p className="assistant-rec-reason t-secondary">{rec.reason}</p>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
