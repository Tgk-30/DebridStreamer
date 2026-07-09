// KeyboardShortcuts - an app-wide reference of every keyboard shortcut, opened
// from the ⌘K command palette ("Keyboard shortcuts"). Complements the player's
// in-context "?" overlay by gathering the global + palette + player keys in one
// place. Pure reference: no state beyond the modal's own dismissal.

import { useModalA11y } from "./useModalA11y";
import { Icon } from "./Icon";
import "./KeyboardShortcuts.css";

interface Group {
  title: string;
  rows: Array<[keys: string, label: string]>;
}

// Only shortcuts the app actually implements are listed here.
const GROUPS: Group[] = [
  {
    title: "Anywhere",
    rows: [["⌘K / Ctrl K", "Open or close the command palette"]],
  },
  {
    title: "Command palette",
    rows: [
      ["↑ / ↓", "Move between results"],
      ["↵ Enter", "Open the highlighted result"],
      ["Esc", "Close the palette"],
    ],
  },
  {
    title: "Player",
    rows: [
      ["Space / K", "Play or pause"],
      ["← / →", "Back / forward 5 seconds"],
      ["J / L", "Back / forward 10 seconds"],
      ["↑ / ↓", "Volume up / down"],
      ["M", "Mute"],
      ["F", "Fullscreen"],
      ["0 – 9", "Jump to 0–90% of the runtime"],
      ["Home / End", "Jump to start / end"],
      ["?", "Show the player shortcuts"],
    ],
  },
  {
    title: "Dialogs & tours",
    rows: [
      ["← / →", "Step back / forward (welcome tour)"],
      ["Esc", "Close the dialog"],
    ],
  },
];

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);

  return (
    <div className="ksh-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="ksh-dialog glass-hero glass-lit"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
      >
        <div className="ksh-head">
          <h2 className="ksh-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="ksh-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="xmark" size={18} />
          </button>
        </div>

        <div className="ksh-groups">
          {GROUPS.map((group) => (
            <section key={group.title} className="ksh-group">
              <h3 className="ksh-group-title t-secondary">{group.title}</h3>
              <ul className="ksh-list">
                {group.rows.map(([keys, label]) => (
                  <li key={keys} className="ksh-row">
                    <kbd className="ksh-keys">{keys}</kbd>
                    <span className="ksh-label">{label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
