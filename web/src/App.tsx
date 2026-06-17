// App shell — mirrors Sources/.../Views/ContentView.swift (the Hybrid nav).
//
// Aurora background + restrained glow, a slim glass NavRail on the left, a
// content area that routes between screens with a simple state-based router,
// and a floating top-right GlobalSearch field (hidden on Settings, like
// ContentView.showsGlobalSearch). Discover is the only fully-built screen this
// phase; the others are on-brand placeholders.

import { useState } from "react";
import "./theme/theme.css";
import { NavRail, type ScreenId } from "./components/NavRail";
import { GlobalSearch } from "./components/GlobalSearch";
import { Discover } from "./screens/Discover";
import { Placeholder } from "./screens/Placeholder";
import type { MediaPreview } from "./models/media";
import "./App.css";

export function App() {
  const [screen, setScreen] = useState<ScreenId>("discover");

  // The global quick-search field is shown on browse screens but not Settings
  // (ContentView.showsGlobalSearch). Search has no dedicated screen this phase.
  const showsGlobalSearch = screen !== "settings";

  function handleSelect(item: MediaPreview) {
    // Detail view lands in a later phase; log for now so the click is wired.
    console.info("[DebridStreamer] selected:", item.title);
  }

  return (
    <div className="app">
      <div className="aurora-glow" />

      <NavRail selected={screen} onSelect={setScreen} />

      <main className="app-content">
        {showsGlobalSearch && (
          <GlobalSearch
            onSubmit={(q) => console.info("[DebridStreamer] search:", q)}
          />
        )}
        {renderScreen(screen, handleSelect)}
      </main>
    </div>
  );
}

function renderScreen(
  screen: ScreenId,
  onSelect: (item: MediaPreview) => void,
) {
  switch (screen) {
    case "discover":
      return <Discover onSelect={onSelect} />;
    case "library":
      return (
        <Placeholder
          icon="library"
          title="Library"
          subtitle="Your saved movies and shows will live here — synced from Trakt and your IMDb exports."
        />
      );
    case "watchlist":
      return (
        <Placeholder
          icon="watchlist"
          title="Watchlist"
          subtitle="Bookmark titles to watch later. Your watchlist syncs across devices."
        />
      );
    case "history":
      return (
        <Placeholder
          icon="history"
          title="History"
          subtitle="Everything you've watched, with resume points for anything still in progress."
        />
      );
    case "assistant":
      return (
        <Placeholder
          icon="assistant"
          title="AI Assistant"
          subtitle="Chat with an AI that knows your taste — ask for recommendations, summaries, and curated lineups."
        />
      );
    case "settings":
      return (
        <Placeholder
          icon="settings"
          title="Settings"
          subtitle="Connect your TMDB key, debrid services, indexers, and AI providers."
        />
      );
  }
}
