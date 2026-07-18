// Release calendar - scheduled episodes from followed series plus TMDB movie
// release dates, rendered as a navigable month cadence with a readable agenda.

import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { ImgWithFallback } from "../components/ImgWithFallback";
import {
  calendarEntries,
  type CalendarEntry,
  useMovieReleaseCalendar,
} from "../data/calendar";
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
type CalendarFilter = "all" | CalendarEntry["kind"];
type CalendarView = "month" | "agenda";

const CALENDAR_FILTER_KEY = "ds_calendar_filter";
const CALENDAR_VIEW_KEY = "ds_calendar_view";

function savedCalendarFilter(): CalendarFilter {
  try {
    const value = globalThis.localStorage?.getItem(CALENDAR_FILTER_KEY);
    return value === "episode" || value === "movie" ? value : "all";
  } catch {
    return "all";
  }
}

function savedCalendarView(): CalendarView {
  try {
    const saved = globalThis.localStorage?.getItem(CALENDAR_VIEW_KEY);
    if (saved === "agenda" || saved === "month") return saved;
    return globalThis.matchMedia?.("(max-width: 767px)").matches
      ? "agenda"
      : "month";
  } catch {
    return "month";
  }
}

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
          <ImgWithFallback
            src={poster}
            alt={entry.media.title}
            loading="lazy"
            draggable={false}
            fallback={
              <div className="cal-release-poster-ph" aria-hidden="true">
                <Icon name={entry.kind === "episode" ? "calendar" : "discover"} size={17} />
              </div>
            }
          />
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
  const {
    calendar: episodeCalendar,
    openDetail,
    navigate,
    openSettingsSection,
    markCalendarSeen,
    refreshCalendar,
    services,
  } = useAppStore();
  const [movieRefreshKey, setMovieRefreshKey] = useState(0);
  // Movie release pages are not useful to the NavRail, so load them only after
  // the Calendar screen itself mounts. Episodes remain store-owned for the
  // app-wide new-release badge.
  const movieCalendar = useMovieReleaseCalendar(services?.tmdb, movieRefreshKey);
  const state = useMemo(
    () => ({
      ...episodeCalendar,
      entries: [
        ...episodeCalendar.entries,
        ...calendarEntries([], movieCalendar.releases),
      ].sort((a, b) =>
        a.date === b.date
          ? a.media.title.localeCompare(b.media.title)
          : a.date.localeCompare(b.date),
      ),
      loading: episodeCalendar.loading || movieCalendar.loading,
      error: episodeCalendar.error ?? movieCalendar.error,
      hasTMDB: episodeCalendar.hasTMDB || movieCalendar.hasTMDB,
    }),
    [episodeCalendar, movieCalendar],
  );
  // A Calendar visit consumes the in-app release indicator. This is deliberately
  // not an OS/push notification acknowledgement or a notification center.
  useEffect(() => {
    markCalendarSeen();
  }, [markCalendarSeen]);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
  const [filter, setFilter] = useState<CalendarFilter>(savedCalendarFilter);
  const [view, setView] = useState<CalendarView>(savedCalendarView);
  const [selectedDate, setSelectedDate] = useState(() => localISODate(new Date()));
  const dayRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusDate = useRef<string | null>(null);
  const filteredEntries = useMemo(
    () => state.entries.filter((entry) => filter === "all" || entry.kind === filter),
    [filter, state.entries],
  );
  const days = useMemo(
    () => calendarMonthDays(visibleMonth, filteredEntries),
    [visibleMonth, filteredEntries],
  );
  const agenda = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of filteredEntries) {
      if (!isInMonth(entry.date, visibleMonth)) continue;
      const entries = grouped.get(entry.date) ?? [];
      entries.push(entry);
      grouped.set(entry.date, entries);
    }
    return [...grouped.entries()];
  }, [visibleMonth, filteredEntries]);
  const today = localISODate(new Date());
  const selectedEntries = useMemo(
    () => filteredEntries.filter((entry) => entry.date === selectedDate),
    [filteredEntries, selectedDate],
  );
  const monthEntries = useMemo(
    () => filteredEntries.filter((entry) => isInMonth(entry.date, visibleMonth)),
    [filteredEntries, visibleMonth],
  );
  const needsTMDBSetup =
    !state.hasTMDB ||
    /(?:tmdb.*api key|api key.*tmdb)/i.test(state.error ?? "");

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CALENDAR_FILTER_KEY, filter);
    } catch {
      // A non-persistent preference is fine.
    }
  }, [filter]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CALENDAR_VIEW_KEY, view);
    } catch {
      // A non-persistent preference is fine.
    }
  }, [view]);

  useEffect(() => {
    if (isInMonth(selectedDate, visibleMonth)) return;
    setSelectedDate(
      isInMonth(today, visibleMonth)
        ? today
        : localISODate(monthStart(visibleMonth)),
    );
  }, [selectedDate, today, visibleMonth]);

  useEffect(() => {
    const date = pendingFocusDate.current;
    if (date == null) return;
    const day = dayRefs.current.get(date);
    if (day == null) return;
    pendingFocusDate.current = null;
    day.focus();
  }, [days, selectedDate]);

  const openEntry = (entry: CalendarEntry) => openDetail(entry.media);
  const openApiSettings = () => openSettingsSection("keys");
  const retryCalendar = () => {
    refreshCalendar();
    setMovieRefreshKey((current) => current + 1);
  };
  const shiftMonth = (delta: number) => {
    setVisibleMonth((current) =>
      new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };
  const focusDate = (date: Date) => {
    const iso = localISODate(date);
    pendingFocusDate.current = iso;
    setSelectedDate(iso);
    if (!isInMonth(iso, visibleMonth)) {
      setVisibleMonth(monthStart(date));
    }
  };
  const moveCalendarFocus = (
    from: string,
    key: string,
    shiftKey: boolean,
  ): boolean => {
    const current = new Date(`${from}T00:00:00`);
    if (Number.isNaN(current.getTime())) return false;
    const next = new Date(current);
    switch (key) {
      case "ArrowLeft":
        next.setDate(current.getDate() - 1);
        break;
      case "ArrowRight":
        next.setDate(current.getDate() + 1);
        break;
      case "ArrowUp":
        next.setDate(current.getDate() - 7);
        break;
      case "ArrowDown":
        next.setDate(current.getDate() + 7);
        break;
      case "Home":
        next.setDate(current.getDate() - current.getDay());
        break;
      case "End":
        next.setDate(current.getDate() + (6 - current.getDay()));
        break;
      case "PageUp":
      case "PageDown": {
        const monthDelta = (key === "PageUp" ? -1 : 1) * (shiftKey ? 12 : 1);
        const month = new Date(
          current.getFullYear(),
          current.getMonth() + monthDelta,
          1,
        );
        const lastDay = new Date(
          month.getFullYear(),
          month.getMonth() + 1,
          0,
        ).getDate();
        next.setFullYear(month.getFullYear(), month.getMonth(), Math.min(current.getDate(), lastDay));
        break;
      }
      case "t":
      case "T":
        focusDate(new Date());
        return true;
      default:
        return false;
    }
    focusDate(next);
    return true;
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
      ) : needsTMDBSetup ? (
        <EmptyState
          icon="calendar"
          title="Add a TMDB key to see release dates"
          subtitle="The calendar uses TMDB for episode air dates and movie release dates."
          note="Add a key in Settings, then follow a TV show to track its episodes."
          actions={(
            <button type="button" className="btn btn-prominent" onClick={openApiSettings}>
              API settings
            </button>
          )}
        />
      ) : state.error ? (
        <EmptyState
          icon="calendar"
          title="Couldn't load the release calendar"
          subtitle="We couldn't reach TMDB for release dates. Check your connection and try again."
          note={state.error}
          actions={(
            <div className="cal-error-actions">
              <button type="button" className="btn btn-prominent" onClick={retryCalendar}>
                Try again
              </button>
              <button type="button" className="btn" onClick={openApiSettings}>
                API settings
              </button>
            </div>
          )}
        />
      ) : state.entries.length === 0 && !state.hasSeries ? (
        <EmptyState
          icon="calendar"
          title="No followed shows yet"
          subtitle="Follow a TV series from its detail page to add its episode schedule here."
          actions={(
            <button type="button" className="btn" onClick={() => navigate("discover")}>
              Browse shows
            </button>
          )}
        />
      ) : state.entries.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled right now"
          subtitle="None of your followed shows have recent or upcoming episodes in TMDB's current release window."
        />
      ) : (
        <>
          <div className="cal-controls" aria-label="Calendar controls">
            <div className="cal-filter" role="radiogroup" aria-label="Release type">
              {([
                ["all", "All"],
                ["episode", "Episodes"],
                ["movie", "Movies"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={filter === value}
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="cal-view-toggle" role="radiogroup" aria-label="Calendar view">
              {(["month", "agenda"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  className={view === value ? "is-active" : ""}
                  onClick={() => setView(value)}
                >
                  {value === "month" ? "Month" : "Agenda"}
                </button>
              ))}
            </div>
          </div>

          <div className="cal-summary" aria-label={`${formatMonth(visibleMonth)} summary`}>
            <span><strong>{monthEntries.length}</strong> releases</span>
            <span><strong>{monthEntries.filter((entry) => entry.kind === "episode").length}</strong> episodes</span>
            <span><strong>{monthEntries.filter((entry) => entry.kind === "movie").length}</strong> movies</span>
          </div>

          {view === "month" ? (
            <div className="cal-month-layout">
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
                      onClick={() => {
                        setVisibleMonth(monthStart(new Date()));
                        setSelectedDate(today);
                      }}
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
                      ref={(element) => {
                        if (element == null) dayRefs.current.delete(day.date);
                        else dayRefs.current.set(day.date, element);
                      }}
                      className={`cal-day${day.inMonth ? "" : " is-outside"}${day.isToday ? " is-today" : ""}${selectedDate === day.date ? " is-selected" : ""}`}
                      role="gridcell"
                      aria-label={`${formatDay(day.date)}${day.isToday ? ", today" : ""}, ${day.entries.length} ${day.entries.length === 1 ? "release" : "releases"}`}
                      aria-current={day.isToday ? "date" : undefined}
                      aria-selected={selectedDate === day.date}
                      tabIndex={day.inMonth && selectedDate === day.date ? 0 : -1}
                      onClick={() => setSelectedDate(day.date)}
                      onFocus={() => {
                        if (day.inMonth) setSelectedDate(day.date);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDate(day.date);
                          return;
                        }
                        if (moveCalendarFocus(day.date, event.key, event.shiftKey)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <span className="cal-day-number">{day.day}</span>
                      <div className="cal-day-events">
                        {day.entries.slice(0, 2).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className={`cal-event cal-event--${entry.kind}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDate(day.date);
                              openEntry(entry);
                            }}
                            title={`${entry.media.title}, ${entry.detail}`}
                            aria-label={`${entry.media.title}, ${entry.detail}`}
                          >
                            <span>{entry.media.title}</span>
                            <small>{entry.kind === "episode" ? entry.detail.split(" · ")[0] : "Movie"}</small>
                          </button>
                        ))}
                        {day.entries.length > 2 && (
                          <span className="cal-more">+{day.entries.length - 2} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="cal-day-panel glass-rest" aria-live="polite">
                <div className="cal-day-panel-head">
                  <span>{selectedDate === today ? "Today" : "Selected day"}</span>
                  <h2>{formatDay(selectedDate)}</h2>
                  <p>{selectedEntries.length} {selectedEntries.length === 1 ? "release" : "releases"}</p>
                </div>
                {selectedEntries.length === 0 ? (
                  <div className="cal-day-panel-empty">
                    <Icon name="calendar" size={22} />
                    <strong>Nothing scheduled</strong>
                    <span>Choose a highlighted date to see its releases.</span>
                  </div>
                ) : (
                  <div className="cal-release-rows">
                    {selectedEntries.map((entry) => (
                      <ReleaseRow key={entry.id} entry={entry} onOpen={openEntry} />
                    ))}
                  </div>
                )}
              </aside>
            </div>
          ) : (
            <section className="cal-agenda cal-agenda--standalone" aria-labelledby="cal-agenda-heading">
              <div className="cal-agenda-toolbar">
                <button type="button" className="cal-month-control" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
                <h2 id="cal-agenda-heading">{formatMonth(visibleMonth)} agenda</h2>
                <div className="cal-toolbar-actions">
                  <button type="button" className="cal-today-btn" onClick={() => setVisibleMonth(monthStart(new Date()))} disabled={isInMonth(today, visibleMonth)}>Today</button>
                  <button type="button" className="cal-month-control" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
                </div>
              </div>
              {agenda.length === 0 ? (
                <p className="cal-agenda-empty t-secondary">No matching releases in {formatMonth(visibleMonth)}.</p>
              ) : (
                <div className="cal-agenda-days">
                  {agenda.map(([date, entries]) => (
                    <section key={date} className="cal-agenda-day" aria-labelledby={`cal-date-${date}`}>
                      <h3 id={`cal-date-${date}`} className={date === today ? "is-today" : undefined}>
                        {date === today ? "Today: " : ""}{formatDay(date)}
                      </h3>
                      <div className="cal-release-rows">
                        {entries.map((entry) => <ReleaseRow key={entry.id} entry={entry} onOpen={openEntry} />)}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
