// EmptyState — a centered on-brand empty/placeholder block used across the
// structural screens (Watchlist, History, Library) and as a search idle hint.

import { Icon, type IconName } from "./Icon";
import type { ReactNode } from "react";
import { AmbientVideo, type AmbientVideoName } from "./AmbientVideo";
import "./EmptyState.css";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Optional small note (e.g. "Pending the storage port"). */
  note?: string;
  actions?: ReactNode;
  /** Optional ambient background loop (decorative). */
  ambient?: AmbientVideoName;
}

export function EmptyState({ icon, title, subtitle, note, actions, ambient }: EmptyStateProps) {
  return (
    <div className={`empty-state glass-rest glass-lit${ambient ? " empty-state-ambient" : ""}`}>
      {ambient && <AmbientVideo name={ambient} opacity={0.2} />}
      <Icon name={icon} size={34} className="t-accent" />
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-sub t-secondary">{subtitle}</p>
      {note && <span className="chip empty-state-note">{note}</span>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}
