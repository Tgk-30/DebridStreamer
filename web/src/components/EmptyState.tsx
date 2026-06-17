// EmptyState — a centered on-brand empty/placeholder block used across the
// structural screens (Watchlist, History, Library) and as a search idle hint.

import { Icon, type IconName } from "./Icon";
import "./EmptyState.css";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Optional small note (e.g. "Pending the storage port"). */
  note?: string;
}

export function EmptyState({ icon, title, subtitle, note }: EmptyStateProps) {
  return (
    <div className="empty-state glass-rest glass-lit">
      <Icon name={icon} size={34} className="t-accent" />
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-sub t-secondary">{subtitle}</p>
      {note && <span className="chip empty-state-note">{note}</span>}
    </div>
  );
}
