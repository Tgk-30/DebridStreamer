// Release calendar - scheduled episodes from followed series plus TMDB movie
// release dates, rendered as a navigable month cadence with a readable agenda.

import { useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { useCalendar, type CalendarEntry } from "../data/calendar";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import { useAppStore } from "../store/AppStore";
import "./LibraryScreens.css";
import "./Calendar.css";

interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isInMonth(date: string, month: Date): boolean {
  return date.startsWith(
    `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
  );
}

function formatMonth(month: Date): string {
  return month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** A friendly countdown for near-term dates, exported for focused helper tests. */
export function relativeAir(iso: string, now = Date.now()): string | null {
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

/** Build the six-week grid used by the visible month. Exported so date math
 * stays testable without a browser render. */
export function calendarMonthDays(
  month: Date,
  entries: CalendarEntry[],
  now = Date.now(),
): CalendarDay[] {
  const first = monthStart(month);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const byDate = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date) ?? [];
    existing.push(entry);
    byDate.set(entry.date, existing);
  }
  const today = localISODate(new Date(now));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = localISODate(date);
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
      isToday: key === today,
      entries: byDate.get(key) ?? [],
    };
  });
}

function entryKind(entry: CalendarEntry): string {
  return entry.kind === "episode" ? "Episode" : "Movie release";
}

function ReleaseRow({
  entry,
  onOpen,
}: {
  entry: CalendarEntry;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const poster = MediaPreviewNS.posterURL(entry.media);
  return (
    <button
      type="button"
      className="cal-release-row glass-rest glass-lit"
      onClick={() => onOpen(entry)}
      title={`Open ${entry.media.title}`}
    >
      <div className="cal-release-poster">
        {poster != null ? (
          <img src={poster} alt={entry.media.title} loading="lazy" draggable={false} />
        ) : (
          <div className="cal-release-poster-ph">
            <Icon name={entry.kind === "episode" ? "calendar" : "discover"} size={17} />
          </div>
        )}
      </div>
      <span className="cal-release-main">
        <span className="cal-release-title">{entry.media.title}</span>
        <span className="cal-release-detail t-secondary">{entry.detail}</span>
      </span>
      <span className={`cal-release-kind cal-release-kind--${entry.kind}`}>
        {entryKind(entry)}
      </span>
    </button>
  );
}

export function Calendar() {
  const { services, openDetail } = useAppStore();
  const state = useCalendar(services.tmdb);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(
    () => calendarMonthDays(visibleMonth, state.entries),
    [visibleMonth, state.entries],
  );
  const agenda = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of state.entries) {
      if (!isInMonth(entry.date, visibleMonth)) continue;
      const entries = grouped.get(entry.date) ?? [];
      entries.push(entry);
      grouped.set(entry.date, entries);
    }
    return [...grouped.entries()];
  }, [visibleMonth, state.entries]);
  const today = localISODate(new Date());

  const openEntry = (entry: CalendarEntry) => openDetail(entry.media);
  const shiftMonth = (delta: number) => {
    setVisibleMonth((current) =>
      new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };

  return (
    <div className="lib-screen cal-screen">
      <div className="cal-title-row">
        <div>
          <h1 className="lib-h1">Release calendar</h1>
          <p className="lib-sub t-secondary">
            Followed episodes and TMDB movie releases on the dates they are scheduled.
          </p>
        </div>
        <div className="cal-legend" aria-label="Calendar legend">
          <span><i className="cal-dot cal-dot--episode" /> Episodes</span>
          <span><i className="cal-dot cal-dot--movie" /> Movie releases</span>
        </div>
      </div>

      {state.loading ? (
        <div className="cal-month cal-month--loading" aria-hidden="true">
          <div className="cal-skel cal-skel-heading" />
          <div className="cal-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="cal-grid">
            {Array.from({ length: 42 }).map((_, index) => (
              <div key={index} className="cal-day cal-day--skel">
                <span className="cal-skel cal-skel-day" />
                {index % 3 === 0 && <span className="cal-skel cal-skel-event" />}
              </div>
            ))}
          </div>
        </div>
      ) : state.error ? (
        <EmptyState
          icon="calendar"
          title="Couldn't load the release calendar"
          subtitle="We couldn't reach TMDB for release dates. Check your connection and try again."
          note={state.error}
        />
      ) : !state.hasTMDB ? (
        <EmptyState
          icon="calendar"
          title="Add a TMDB key to see release dates"
          subtitle="The calendar uses TMDB for episode air dates and movie release dates."
          note="Add a key in Settings, then follow a TV show to track its episodes."
        />
      ) : state.entries.length === 0 && !state.hasSeries ? (
        <EmptyState
          icon="calendar"
          title="No followed shows yet"
          subtitle="Follow a TV series from its detail page to add its episode schedule here."
        />
      ) : state.entries.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled right now"
          subtitle="None of your followed shows have recent or upcoming episodes in TMDB's current release window."
        />
      ) : (
        <>
          <section className="cal-month" aria-label={`${formatMonth(visibleMonth)} release calendar`}>
            <div className="cal-toolbar">
              <button
                type="button"
                className="cal-month-control"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
              >
                ‹
              </button>
              <h2 className="cal-month-label" aria-live="polite">{formatMonth(visibleMonth)}</h2>
              <div className="cal-toolbar-actions">
                <button
                  type="button"
                  className="cal-today-btn"
                  onClick={() => setVisibleMonth(monthStart(new Date()))}
                  disabled={isInMonth(today, visibleMonth)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="cal-month-control"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="cal-weekdays" aria-hidden="true">
              {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="cal-grid" role="grid" aria-label={`${formatMonth(visibleMonth)} releases`}>
              {days.map((day) => (
                <div
                  key={day.date}
                  className={`cal-day${day.inMonth ? "" : " is-outside"}${day.isToday ? " is-today" : ""}`}
                  role="gridcell"
                  aria-label={`${formatDay(day.date)}${day.isToday ? ", today" : ""}`}
                >
                  <span className="cal-day-number">{day.day}</span>
                  <div className="cal-day-events">
                    {day.entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`cal-event cal-event--${entry.kind}`}
                        onClick={() => openEntry(entry)}
                        title={`Open ${entry.media.title}`}
                        aria-label={`${entry.media.title}, ${entry.detail}`}
                      >
                        <span>{entry.media.title}</span>
                        <small>{entry.kind === "episode" ? entry.detail.split(" · ")[0] : "Movie"}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cal-agenda" aria-labelledby="cal-agenda-heading">
            <div className="cal-agenda-head">
              <h2 id="cal-agenda-heading">{formatMonth(visibleMonth)} agenda</h2>
              <span>{agenda.reduce((count, [, entries]) => count + entries.length, 0)} releases</span>
            </div>
            {agenda.length === 0 ? (
              <p className="cal-agenda-empty t-secondary">
                No releases scheduled in {formatMonth(visibleMonth)}. Use the month controls to explore the current release window.
              </p>
            ) : (
              <div className="cal-agenda-days">
                {agenda.map(([date, entries]) => (
                  <section key={date} className="cal-agenda-day" aria-labelledby={`cal-date-${date}`}>
                    <h3 id={`cal-date-${date}`} className={date === today ? "is-today" : undefined}>
                      {date === today ? "Today · " : ""}{formatDay(date)}
                    </h3>
                    <div className="cal-release-rows">
                      {entries.map((entry) => (
                        <ReleaseRow key={entry.id} entry={entry} onOpen={openEntry} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
