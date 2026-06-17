// Calendar screen — upcoming episode air dates for the user's TV series.
//
// For every TV series in the Library + Watchlist it shows the next/unaired
// episodes grouped by Today / This week / Upcoming. Each row is a show + S/E +
// title + air date, tappable to open that show's Detail. Fault-tolerant and
// concurrent (see data/calendar + lib/metadata). Gates gracefully without a
// TMDB key or when the user has no series saved.

import { useAppStore } from "../store/AppStore";
import { useCalendar } from "../data/calendar";
import type { UpcomingEpisode } from "../lib/metadata";
import { EmptyState } from "../components/EmptyState";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import { Icon } from "../components/Icon";
import "./LibraryScreens.css";
import "./Calendar.css";

/** "S02E07" style code. */
function episodeCode(ep: UpcomingEpisode): string {
  const s = String(ep.seasonNumber).padStart(2, "0");
  const e = String(ep.episodeNumber).padStart(2, "0");
  return `S${s}E${e}`;
}

/** "Mon, Jun 23" style date — air dates are date-only (YYYY-MM-DD). */
function formatAirDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function Calendar() {
  const { services, openDetail } = useAppStore();
  const state = useCalendar(services.tmdb);

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">Calendar</h1>
      <p className="lib-sub t-secondary">
        Upcoming episodes for the shows in your library and watchlist.
      </p>

      {state.loading ? (
        <p className="t-secondary cal-status">Loading upcoming episodes…</p>
      ) : state.error ? (
        <EmptyState
          icon="calendar"
          title="Couldn't load the calendar"
          subtitle="We couldn't reach TMDB for your shows' air dates. Check your connection and try again."
          note={state.error}
        />
      ) : !state.hasTMDB ? (
        <EmptyState
          icon="calendar"
          title="Add a TMDB key to see air dates"
          subtitle="The calendar pulls upcoming episode dates from TMDB. Add a key in Settings to light it up."
          note="Then add some TV shows to your library or watchlist"
        />
      ) : !state.hasSeries ? (
        <EmptyState
          icon="calendar"
          title="No shows to track yet"
          subtitle="Add TV series to your library or watchlist and their upcoming episodes will appear here."
        />
      ) : state.groups.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing on the horizon"
          subtitle="None of your saved shows have upcoming episodes scheduled right now. Check back later."
        />
      ) : (
        <div className="cal-groups">
          {state.groups.map((group) => (
            <section key={group.bucket} className="cal-group">
              <h2 className="cal-group-label">{group.label}</h2>
              <div className="cal-rows">
                {group.episodes.map((ep) => (
                  <button
                    key={`${ep.series.id}-${ep.seasonNumber}-${ep.episodeNumber}`}
                    type="button"
                    className="cal-row glass-rest glass-lit"
                    onClick={() => openDetail(ep.series)}
                    title={`Open ${ep.series.title}`}
                  >
                    <div className="cal-row-poster">
                      {MediaPreviewNS.posterURL(ep.series) ? (
                        <img
                          src={MediaPreviewNS.posterURL(ep.series) ?? undefined}
                          alt={ep.series.title}
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="cal-row-poster-ph">
                          <Icon name="calendar" size={18} />
                        </div>
                      )}
                    </div>
                    <div className="cal-row-main">
                      <div className="cal-row-title">{ep.series.title}</div>
                      <div className="cal-row-sub t-secondary">
                        <span className="cal-code">{episodeCode(ep)}</span>
                        {ep.title && <span className="cal-eptitle">{ep.title}</span>}
                      </div>
                    </div>
                    <div className="cal-row-date">{formatAirDate(ep.airDate)}</div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
