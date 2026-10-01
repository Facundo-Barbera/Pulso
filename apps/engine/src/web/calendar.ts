/**
 * What the web app's Calendario page and Hoy's week strip draw: the merged
 * timeline (src/calendar/timeline.ts) cut into days, plus what the editors
 * need — busy block definitions, health events and availability. Read-only.
 */
import type { BusyBlock, CalendarItem, CalendarPreferences, HealthEvent, PlannedSession } from "@pulso/contract";
import { plannedView } from "../calendar/schedule";
import { getPreferences, listBusyBlocks, listHealthEvents } from "../calendar/store";
import { addDays, DATE, local, weekStart } from "../calendar/time";
import { timeline } from "../calendar/timeline";

export type CalendarView = "semana" | "mes" | "salud";
export type CalendarDay = { date: string; items: CalendarItem[] };

export type CalendarPage = {
  view: CalendarView;
  today: string;
  /** The selected day (defaults to today). */
  day: string;
  /** The range drawn: a Monday-to-Sunday week, or the six weeks around a month. Empty `days` for «Salud». */
  from: string;
  to: string;
  days: CalendarDay[];
  /** Definitions behind the busy items in range, for the editor. */
  busyBlocks: BusyBlock[];
  /** All of them: active first, then history. */
  healthEvents: HealthEvent[];
  preferences: CalendarPreferences;
  /** Upcoming planned sessions that still clash with something (re-plan could not move them). */
  conflicts: PlannedSession[];
};

const VIEWS: CalendarView[] = ["semana", "mes", "salud"];
const CONFLICT_DAYS = 14;

/** Every date in [from, to] with its items, in timeline order. */
function byDay(from: string, to: string, items: CalendarItem[]): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push({ date, items: [] });
  const index = new Map(days.map((d) => [d.date, d]));
  for (const item of items) index.get(item.date)?.items.push(item);
  return days;
}

export function calendarPage(opts: { view?: string | null; day?: string | null } = {}, now = new Date()): CalendarPage {
  const today = local(now).date;
  const view = VIEWS.includes(opts.view as CalendarView) ? (opts.view as CalendarView) : "semana";
  const day = opts.day && DATE.test(opts.day) ? opts.day : today;

  let from = day;
  let to = day;
  if (view === "semana") {
    from = weekStart(day);
    to = addDays(from, 6);
  } else if (view === "mes") {
    from = weekStart(`${day.slice(0, 8)}01`);
    to = addDays(from, 41);
  }
  const days = view === "salud" ? [] : byDay(from, to, timeline(from, to, now).items);

  return {
    view,
    today,
    day,
    from,
    to,
    days,
    busyBlocks: view === "salud" ? [] : listBusyBlocks({ from, to }),
    healthEvents: listHealthEvents(),
    preferences: getPreferences(),
    conflicts: plannedView(today, addDays(today, CONFLICT_DAYS), today).filter((p) => p.conflict && p.status !== "skipped" && p.status !== "done"),
  };
}

export type WeekStrip = {
  today: string;
  /** Monday to Sunday of this week. */
  days: CalendarDay[];
  /** What comes next today and tomorrow: plans, meal times, busy blocks, health. At most `UPCOMING`. */
  upcoming: CalendarItem[];
};

const UPCOMING = 3;
/** Things that already happened (sleep, logged meals and doses, workouts) are not "next". */
const AHEAD = new Set<CalendarItem["kind"]>(["training", "meal_time", "busy", "health"]);

export function weekStrip(now = new Date()): WeekStrip {
  const { date: today, time } = local(now);
  const from = weekStart(today);
  const to = addDays(from, 6);
  const tomorrow = addDays(today, 1);
  // Tomorrow can fall in next week (on Sunday): read up to it.
  const items = timeline(from, tomorrow > to ? tomorrow : to, now).items;
  const nowAt = `${today}T${time}`;
  const upcoming = items
    .filter((i) => AHEAD.has(i.kind) && (i.date === today || i.date === tomorrow))
    .filter((i) => (i.allDay ? i.date === today : (i.end ?? i.start ?? "") >= nowAt))
    .filter((i) => i.kind !== "training" || i.status === "planned" || i.status === "moved")
    .slice(0, UPCOMING);
  return { today, days: byDay(from, to, items), upcoming };
}
