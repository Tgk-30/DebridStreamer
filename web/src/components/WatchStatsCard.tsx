// Opt-in "Your watching" insights card for the History screen. Renders a small
// row of headline tiles (time watched, titles, completion, streak) plus a
// hand-rolled favourite-genres bar chart (no charting dependency). Purely
// presentational — all aggregation lives in data/watchStats.ts.

import { formatWatchTime, type WatchStats } from "../data/watchStats";
import { Icon } from "./Icon";
import "./WatchStatsCard.css";

export function WatchStatsCard({ stats }: { stats: WatchStats }) {
  const completionPct = Math.round(stats.completionRate * 100);
  const maxGenre = stats.favoriteGenres.reduce(
    (m, g) => Math.max(m, g.count),
    0,
  );

  return (
    <section
      className="watch-stats glass-rest"
      aria-label="Your watching stats"
    >
      <header className="watch-stats-head">
        <Icon name="history" size={16} className="t-accent" />
        <h2 className="watch-stats-title">Your watching</h2>
      </header>

      <div className="watch-stats-tiles">
        <Tile label="Time watched" value={formatWatchTime(stats.totalSeconds)} />
        <Tile label="Titles" value={String(stats.titles)} />
        <Tile label="Completed" value={`${completionPct}%`} />
        <Tile
          label={stats.streakOngoing ? "Day streak" : "Last streak"}
          value={
            stats.streakDays > 0
              ? `${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`
              : "—"
          }
          accent={stats.streakOngoing && stats.streakDays > 0}
        />
      </div>

      {stats.favoriteGenres.length > 0 && (
        <div className="watch-stats-genres">
          <p className="watch-stats-genres-label t-secondary">Favourite genres</p>
          <ul className="watch-stats-bars">
            {stats.favoriteGenres.map((g) => (
              <li key={g.genre} className="watch-stats-bar-row">
                <span className="watch-stats-bar-name">{g.genre}</span>
                <span className="watch-stats-bar-track" aria-hidden>
                  <span
                    className="watch-stats-bar-fill"
                    style={{
                      width: `${maxGenre > 0 ? (g.count / maxGenre) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className="watch-stats-bar-count t-secondary">
                  {g.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="watch-stats-tile">
      <span className={`watch-stats-tile-value${accent ? " is-accent" : ""}`}>
        {value}
      </span>
      <span className="watch-stats-tile-label t-secondary">{label}</span>
    </div>
  );
}
