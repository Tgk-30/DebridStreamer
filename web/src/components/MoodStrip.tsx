// Port of Sources/DebridStreamer/Views/Catalog/MoodDiscoveryView.swift (the
// "Describe a vibe" AI mood strip — the app's differentiator).
//
// Header (wand glyph + "Describe a vibe" + subtitle), a prompt field with a
// Curate button, and starter suggestion chips. VISUAL-ONLY this phase: there's
// no AIAssistantManager wired yet, so Curate emits the vibe through an optional
// callback (the parent currently no-ops / shows a hint). The real path
// (assistant.discoverFilters → service.discover) lands in a later phase.

import { useState } from "react";
import { Icon } from "./Icon";
import "./MoodStrip.css";

// MoodDiscoveryView.suggestions
const SUGGESTIONS = [
  "Cozy fall mysteries",
  "Mind-bending sci-fi from the 2010s",
  "Feel-good road trips",
  "Slow-burn psychological thrillers",
];

interface MoodStripProps {
  /** Fired on Curate / chip tap. Visual-only this phase. */
  onCurate?: (vibe: string) => void;
}

export function MoodStrip({ onCurate }: MoodStripProps) {
  const [vibe, setVibe] = useState("");

  const trimmed = vibe.trim();

  function curate(value: string) {
    const v = value.trim();
    if (!v) return;
    onCurate?.(v);
  }

  return (
    <section className="mood glass-raised glass-lit">
      <div className="mood-header">
        <Icon name="assistant" size={20} className="t-accent" />
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
          placeholder="e.g. cozy fall mysteries"
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
          disabled={trimmed.length === 0}
          onClick={() => curate(vibe)}
        >
          Curate
        </button>
      </div>

      <div className="mood-chips">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => {
              setVibe(s);
              curate(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
