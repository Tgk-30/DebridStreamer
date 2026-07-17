// CommandPalette - a ⌘K / Ctrl+K quick switcher. It is hidden until invoked, so
// it adds power-user navigation speed across this feature-rich app (9 screens +
// settings + themes) without adding any always-on UI. Composes existing store
// actions only (navigate / search / theme), so there is no new state to maintain.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { THEMES } from "../theme/themes";
import { Icon, type IconName } from "./Icon";
import type { ScreenId } from "./NavRail";
import "./CommandPalette.css";

interface Command {
  id: string;
  label: string;
  icon: IconName;
  hint?: string;
  keywords?: string;
  run: () => void;
}

const NAV_TARGETS: Array<{ id: ScreenId; label: string; icon: IconName }> = [
  { id: "discover", label: "Discover", icon: "discover" },
  { id: "search", label: "Search", icon: "search" },
  { id: "library", label: "Library", icon: "library" },
  { id: "watchlist", label: "Watchlist", icon: "watchlist" },
  { id: "history", label: "History", icon: "history" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function CommandPalette({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const { navigate, search, settings, updateSettings } = useAppStore();
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global ⌘K / Ctrl+K toggles; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset + focus whenever it opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = () => setOpen(false);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV_TARGETS.map((t) => ({
      id: `nav:${t.id}`,
      label: `Go to ${t.label}`,
      icon: t.icon,
      keywords: t.label,
      run: () => {
        navigate(t.id);
        close();
      },
    }));
    for (const th of THEMES) {
      list.push({
        id: `theme:${th.id}`,
        label: `Theme: ${th.label}`,
        icon: "sparkles",
        keywords: `theme appearance ${th.label}`,
        hint: settings.theme === th.id ? "Active" : undefined,
        run: () => {
          updateSettings({ ...settings, theme: th.id });
          close();
        },
      });
    }
    list.push({
      id: "setup-wizard",
      label: "Run guided setup",
      icon: "sliders",
      keywords: "setup wizard configure onboarding get started first run debrid source",
      run: () => {
        window.dispatchEvent(new CustomEvent("ds:open-first-run"));
        close();
      },
    });
    list.push({
      id: "welcome-tour",
      label: "Show welcome tour",
      icon: "sparkles",
      keywords: "tour guide welcome help onboarding intro getting started",
      run: () => {
        window.dispatchEvent(new CustomEvent("ds:open-welcome-guide"));
        close();
      },
    });
    list.push({
      id: "app-tour",
      label: "Take the app tour",
      icon: "sparkles",
      keywords: "tour walkthrough highlight spotlight guide onboarding where is",
      run: () => {
        window.dispatchEvent(new CustomEvent("ds:open-tour"));
        close();
      },
    });
    list.push({
      id: "keyboard-shortcuts",
      label: "Keyboard shortcuts",
      icon: "sliders",
      keywords: "keyboard shortcuts keys hotkeys help reference",
      run: () => {
        window.dispatchEvent(new CustomEvent("ds:open-shortcuts"));
        close();
      },
    });
    return list;
  }, [navigate, search, settings, updateSettings]);

  const filtered = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? commands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            (c.keywords ?? "").toLowerCase().includes(q),
        )
      : commands;
    if (q) {
      // A catalog search is always offered for the typed text, at the top.
      return [
        {
          id: "search-run",
          label: `Search catalog for “${query.trim()}”`,
          icon: "search",
          run: () => {
            search(query.trim());
            close();
          },
        },
        ...matches,
      ];
    }
    return matches;
  }, [commands, query, search]);

  // Keep the active index in range as the filtered set changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return (
    <div
      className="cmdk-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmdk-panel">
        <div className="cmdk-input-row">
          <Icon name="search" size={18} className="cmdk-input-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            placeholder="Search a screen, theme, or title…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>

        <ul className="cmdk-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <li className="cmdk-empty">No matches</li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                className={`cmdk-item${i === active ? " is-active" : ""}`}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  c.run();
                }}
              >
                <Icon name={c.icon} size={16} className="cmdk-item-icon" />
                <span className="cmdk-item-label">{c.label}</span>
                {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
              </li>
            ))
          )}
        </ul>

        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}
