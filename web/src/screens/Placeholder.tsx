// Lightweight placeholder for the not-yet-built screens (Library, Watchlist,
// History, Assistant, Settings). Discover is the only real screen this phase;
// these keep the nav navigable and on-brand until later phases fill them in.

import { Icon, type IconName } from "../components/Icon";
import "./Placeholder.css";

interface PlaceholderProps {
  icon: IconName;
  title: string;
  subtitle: string;
}

export function Placeholder({ icon, title, subtitle }: PlaceholderProps) {
  return (
    <div className="placeholder">
      <div className="placeholder-card glass-raised glass-lit">
        <Icon name={icon} size={40} className="t-accent" />
        <h1 className="placeholder-title">{title}</h1>
        <p className="placeholder-subtitle t-secondary">{subtitle}</p>
        <span className="chip placeholder-badge">Coming soon</span>
      </div>
    </div>
  );
}
