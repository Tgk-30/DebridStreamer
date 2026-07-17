// Port of GlobalSearchField (Sources/.../Views/Shell/NavRail.swift).
//
// A floating glass quick-search pill anchored top-right: magnifier glyph, a
// ~184px text field, and a clear (xmark) button once there's text. In the
// native app submitting routes to the Search screen via pendingSearchQuery;
// here it's wired through a callback (Search is a placeholder this phase).

import { memo, useState } from "react";
import { useAppActions } from "../store/AppStore";
import { Icon } from "./Icon";
import "./GlobalSearch.css";

export const GlobalSearch = memo(function GlobalSearch() {
  const { search } = useAppActions();
  const [text, setText] = useState("");

  function submit() {
    const q = text.trim();
    if (!q) return;
    search(q);
  }

  return (
    <div className="global-search glass-raised glass-lit field">
      <Icon name="search" size={14} className="t-secondary" />
      <input
        type="text"
        placeholder="Search movies & shows"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        aria-label="Search movies and shows"
      />
      {text.length > 0 && (
        <button
          type="button"
          className="global-search-clear"
          onClick={() => setText("")}
          title="Clear"
          aria-label="Clear search"
        >
          <Icon name="xmark" size={14} />
        </button>
      )}
    </div>
  );
});
