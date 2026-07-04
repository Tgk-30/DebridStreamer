// Calendar screen — upcoming episode air dates for the user's TV series.
//
// For every TV series in the Library + Watchlist it shows the next/unaired
// episodes grouped by Today / This week / Upcoming. Each row is a show + S/E +
// title + air date, tappable to open that show's Detail. Fault-tolerant and
// concurrent (see data/calendar + lib/metadata). Gates gracefully without a
// TMDB key or when the user has no series saved.

import { Fragment } from "react";
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

/** A friendly countdown for near-term air dates: "Today", "Tomorrow", or
 * "In N days" (within a week). Returns null further out — the absolute date
 * carries it. Date-only inputs are parsed at LOCAL midnight to match
 * formatAirDate, so the "today" boundary is the user's local day. Exported for
 * unit tests (with an injectable `now`). */
export function relativeAir(iso: string, now = Date.now()): string | null {
  // Require a full YYYY-MM-DD: `new Date("2026-07T00:00:00")` parses leniently
  // (to Jul 1), which would give a bogus countdown for a partial air date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const air = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(air.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((air.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `In ${days} days`;
  return null;
}

/** "August 2026" — the month sub-header label for the Upcoming bucket. Null for
 * an unparseable date, so we never render a garbage month divider. */
function monthLabel(iso: string): string | null {
  // Strict full-date check — a partial ISO ("2026-07") parses leniently and
  // would render a garbage/misleading month divider.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
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
        <div className="cal-groups" aria-hidden="true">
          {[3, 3].map((count, gi) => (
            <section key={gi} className="cal-group">
              <div className="cal-group-label cal-skel cal-skel-label" />
              <div className="cal-rows">
                {Array.from({ length: count }).map((_, ri) => (
                  <div key={ri} className="cal-row cal-row-skel glass-rest">
                    <div className="cal-row-poster cal-skel" />
                    <div className="cal-row-main">
                      <div className="cal-skel cal-skel-title" />
                      <div className="cal-skel cal-skel-sub" />
                    </div>
                    <div className="cal-skel cal-skel-date" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
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
            <section
              key={group.bucket}
              className={
                "cal-group" + (group.bucket === "today" ? " cal-group--today" : "")
              }
            >
              <h2 className="cal-group-label">{group.label}</h2>
              <div className="cal-rows">
                {group.episodes.map((ep, i) => {
                  const when = relativeAir(ep.airDate);
                  // Month sub-headers break up the long "Upcoming" list; the
                  // episodes arrive pre-sorted by air date, so a plain
                  // adjacent-comparison is enough.
                  const isNewMonth =
                    group.bucket === "later" &&
                    (i === 0 ||
                      ep.airDate.slice(0, 7) !==
                        group.episodes[i - 1].airDate.slice(0, 7));
                  const month = isNewMonth ? monthLabel(ep.airDate) : null;
                  return (
                    <Fragment
                      key={`${ep.series.id}-${ep.seasonNumber}-${ep.episodeNumber}`}
                    >
                      {month != null && (
                        <div className="cal-month-sep">{month}</div>
                      )}
                      <button
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
                            {ep.title && (
                              <span className="cal-eptitle">{ep.title}</span>
                            )}
                          </div>
                        </div>
                        <div className="cal-row-date">
                          {when != null && (
                            <span className="cal-row-when">{when}</span>
                          )}
                          <span className="cal-row-abs">{formatAirDate(ep.airDate)}</span>
                        </div>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
