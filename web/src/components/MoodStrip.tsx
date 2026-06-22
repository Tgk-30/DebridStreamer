// Port of Sources/DebridStreamer/Views/Catalog/MoodDiscoveryView.swift (the
// "Describe a vibe" AI mood strip — the app's differentiator).
//
// Header (wand glyph + "Describe a vibe" + subtitle), a prompt field with a
// Curate button, and starter suggestion chips. The parent decides whether the
// vibe is handled by AI recommendations or a regular Browse search fallback.

import { useState } from "react";
import { Icon } from "./Icon";
import "./MoodStrip.css";

// MoodDiscoveryView.suggestions
const SUGGESTIONS = [
  "Cozy fall mysteries",
  "2010s sci-fi puzzles",
  "Feel-good road trips",
  "Slow-burn thrillers",
];

interface MoodStripProps {
  /** Fired on Curate / chip tap. */
  onCurate?: (vibe: string) => void | Promise<void>;
  loading?: boolean;
  status?: string | null;
  error?: string | null;
}

export function MoodStrip({
  onCurate,
  loading = false,
  status = null,
  error = null,
}: MoodStripProps) {
  const [vibe, setVibe] = useState("");

  const trimmed = vibe.trim();

  function curate(value: string) {
    const v = value.trim();
    if (!v || loading) return;
    void onCurate?.(v);
  }

  return (
    <section className="mood">
      <div className="mood-header">
        <Icon name="sparkles" size={19} className="t-accent" />
        <div className="mood-heading">
          <div className="mood-title">Describe a vibe</div>
          <div className="mood-subtitle t-secondary">
            AI turns your mood into a curated lineup
          </div>
        </div>
      </div>

      <div className="mood-prompt glass-rest field">
        <Icon name="wand-search" size={16} className="t-secondary" />
        <input
          type="text"
          placeholder="e.g. rainy noir movies"
          value={vibe}
          onChange={(e) => setVibe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") curate(vibe);
          }}
          aria-label="Describe a vibe"
        />
        <button
          type="button"
          className="btn btn-prominent mood-curate"
          disabled={trimmed.length === 0 || loading}
          onClick={() => curate(vibe)}
        >
          {loading ? "Curating" : "Curate"}
        </button>
      </div>

      <div className="mood-chips">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            title={s}
            onClick={() => {
              setVibe(s);
              curate(s);
            }}
          >
            <span className="mood-chip-label">{s}</span>
          </button>
        ))}
      </div>

      {(status != null || error != null) && (
        <p className={`mood-status${error != null ? " is-error" : ""}`} role="status">
          {error ?? status}
        </p>
      )}
    </section>
  );
}
