// Port of Sources/DebridStreamer/Views/Catalog/MoodDiscoveryView.swift.
//
// Header (wand glyph + "Describe a vibe" + subtitle), a prompt field with a
// Curate button, and starter suggestion chips. The parent decides which
// recommendation or browse service handles the request.

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
  /** Whether a personalized curation service is available. */
  aiAvailable?: boolean;
  /** Search uses the same controls in a compact inline treatment. */
  variant?: "default" | "search";
}

export function MoodStrip({
  onCurate,
  loading = false,
  status = null,
  error = null,
  aiAvailable = true,
  variant = "default",
}: MoodStripProps) {
  const [vibe, setVibe] = useState("");

  const trimmed = vibe.trim();

  function curate(value: string) {
    const v = value.trim();
    if (!v || loading) return;
    void onCurate?.(v);
  }

  return (
    <section className={`mood${variant === "search" ? " mood-search" : ""}`}>
      <div className="mood-header">
        <Icon name="discover" size={19} className="t-accent" />
        <div className="mood-heading">
          <div className="mood-title">Describe a vibe</div>
          <div className="mood-subtitle t-secondary">
            {aiAvailable
              ? "Turn a mood into a curated lineup"
              : "Search by mood, era, genre, or theme"}
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
          {loading ? (
            <>
              <span className="mood-spinner" aria-hidden="true" />
              Curating
            </>
          ) : (
            "Curate"
          )}
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
