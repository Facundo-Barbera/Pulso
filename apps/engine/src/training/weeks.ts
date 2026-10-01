import type { Program, ProgramWeek, TrainingBlock, WeekDay, WeekSession } from "@pulso/contract";
import { db } from "../db";

/**
 * A block's weeks. Weeks are calendar weeks, Monday to Sunday on the Mac's
 * clock (the person's). Week 1 is the calendar week of the block's first
 * session — not of the day the program was written, so a program made on a
 * Sunday for Monday doesn't open with a missed week — and the current week
 * until there is one. A day is done in week N when a session of that day
 * started inside week N. Starting the next week early begins it that moment;
 * it then runs to the end of the following calendar week, and the weeks after
 * it fall on Mondays again.
 */

/** Under this share of a day's prescribed sets (a cardio block counts as one), its session is "partial". */
export const PARTIAL_SHARE = 0.75;

/** Local midnight of the Monday of `at`'s calendar week. */
export function mondayOf(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** `at` moved by whole calendar days, keeping the local time across DST. */
function plusDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export type WeekBounds = { startsAt: number; endsAt: number; startedEarly: boolean };

/**
 * Where each of `count` weeks begins and ends (`endsAt` exclusive). `early`
 * maps a week number to the instant it was begun early.
 */
export function weekBounds(count: number, anchor: number, early: Map<number, number> = new Map()): WeekBounds[] {
  const out: WeekBounds[] = [];
  let start = mondayOf(anchor);
  let startedEarly = false;
  for (let n = 1; n <= Math.max(count, 1); n++) {
    const monday = mondayOf(start);
    const natural = plusDays(monday, start === monday ? 7 : 14);
    const next = early.get(n + 1);
    const end = next !== undefined && next > start && next < natural ? next : natural;
    out.push({ startsAt: start, endsAt: end, startedEarly });
    startedEarly = end !== natural;
    start = end;
  }
  return out;
}

/** The sentences of the notes that mention a deload. */
const deloadSentences = (notes: string | null) =>
  (notes ?? "")
    .split(/(?<=[.;\n])/)
    .map((s) => s.trim())
    .filter((s) => /descarga|deload/i.test(s));

function namesWeek(sentence: string, week: number, weeks: number): boolean {
  const lower = sentence.toLowerCase();
  const numbers = (lower.match(/\d+/g) ?? []).map(Number);
  if (lower.includes("cada") || lower.includes("every")) return numbers[0] !== undefined && numbers[0] > 0 && week % numbers[0] === 0;
  if (week === weeks && ["última", "ultima", "last", "final"].some((w) => lower.includes(w))) return true;
  return numbers.includes(week);
}

/**
 * True when a sentence of the notes that mentions a deload names this week:
 * "semana 4 de descarga", "descarga cada 4 semanas", "última semana: descarga".
 */
export function isDeload(week: number, weeks: number, notes: string | null): boolean {
  return deloadSentences(notes).some((s) => namesWeek(s, week, weeks));
}

/** The notes' sentence about a deload in this week, as written. */
export function deloadNote(week: number, weeks: number, notes: string | null): string | null {
  return deloadSentences(notes).find((s) => namesWeek(s, week, weeks)) ?? null;
}

type SessionRow = { id: string; day_id: string | null; name: string; started_at: number; ended_at: number; sets: number; cardio_blocks: number; cardio_seconds: number };

const SESSION_COLUMNS = `t.id, t.day_id, t.name, t.started_at, t.ended_at,
  (SELECT COUNT(*) FROM set_logs s WHERE s.session_id = t.id) AS sets,
  (SELECT COUNT(*) FROM cardio_logs c WHERE c.session_id = t.id) AS cardio_blocks,
  (SELECT COALESCE(SUM(c.duration_seconds), 0) FROM cardio_logs c WHERE c.session_id = t.id) AS cardio_seconds`;

const toWeekSession = (r: SessionRow): WeekSession => ({
  id: r.id,
  dayId: r.day_id,
  name: r.name,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  sets: r.sets,
  cardioMinutes: Math.round(r.cardio_seconds / 6) / 10,
});

type BlockRow = { created_at: number; ended_at: number | null; end_reason: string | null; resumed_from: string | null; active: number; number: number };

/** Week number → the instant it was begun early. */
export function earlyStarts(programId: string): Map<number, number> {
  const rows = db().query<{ week: number; starts_at: number }, [string]>("SELECT week, starts_at FROM program_week_starts WHERE program_id = ?").all(programId);
  return new Map(rows.map((r) => [r.week, r.starts_at]));
}

/** A program's sessions, oldest first, matched by its day ids. */
function sessionsOf(programId: string): SessionRow[] {
  return db()
    .query<SessionRow, [string]>(`SELECT ${SESSION_COLUMNS} FROM training_sessions t WHERE t.day_id IN (SELECT id FROM program_days WHERE program_id = ?) ORDER BY t.started_at`)
    .all(programId);
}

function sessionsBetween(from: number, to: number): SessionRow[] {
  return db().query<SessionRow, [number, number]>(`SELECT ${SESSION_COLUMNS} FROM training_sessions t WHERE t.started_at >= ? AND t.started_at < ? ORDER BY t.started_at`).all(from, to);
}

/**
 * The block `program` is, week by week, as of `now`: what was done, partial
 * or missed each week, the week now, and whether the next one may start early.
 * An ended block is read as of its end and lists only the weeks it reached.
 */
export function programWeeks(program: Program, now = Date.now()): TrainingBlock {
  const meta = db()
    .query<BlockRow, [string]>(
      `SELECT p.created_at, p.ended_at, p.end_reason, p.resumed_from, p.active,
         (SELECT COUNT(*) FROM programs o WHERE (o.active = 1 OR o.ended_at IS NOT NULL) AND o.created_at <= p.created_at) AS number
       FROM programs p WHERE p.id = ?`,
    )
    .get(program.id);
  const endedAt = meta?.ended_at ?? null;
  const clock = endedAt == null ? now : Math.min(now, endedAt);
  const own = sessionsOf(program.id);
  const anchor = own[0]?.started_at ?? (endedAt == null ? now : program.createdAt);
  const all = weekBounds(program.weeks, anchor, earlyStarts(program.id));
  const finished = clock >= all.at(-1)!.endsAt;
  const reached = endedAt == null ? all : all.filter((b, i) => i === 0 || b.startsAt < endedAt);
  const currentWeek = finished ? reached.length : Math.max(1, reached.findIndex((b) => clock >= b.startsAt && clock < b.endsAt) + 1);
  const range = sessionsBetween(reached[0]!.startsAt, reached.at(-1)!.endsAt);
  const dayIds = new Set(program.days.map((d) => d.id));

  const weeks = reached.map((b, i): ProgramWeek => {
    const number = i + 1;
    const state = endedAt != null || finished || number < currentWeek ? "past" : number === currentWeek ? "current" : "future";
    const inWeek = (s: SessionRow) => s.started_at >= b.startsAt && s.started_at < b.endsAt;
    const days = program.days.map((day): WeekDay => {
      const rows = own.filter((s) => s.day_id === day.id && inWeek(s));
      const planned = day.exercises.reduce((n, ex) => n + (ex.kind === "cardio" ? 1 : ex.sets), 0);
      const best = Math.max(0, ...rows.map((r) => r.sets + r.cardio_blocks));
      const status = rows.length ? (planned > 0 && best < PARTIAL_SHARE * planned ? "partial" : "done") : state === "past" ? "missed" : "planned";
      return { dayId: day.id, name: day.name, status, sessions: rows.map(toWeekSession) };
    });
    return {
      number,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      state,
      startedEarly: b.startedEarly,
      deload: isDeload(number, program.weeks, program.notes),
      note: deloadNote(number, program.weeks, program.notes),
      days,
      done: days.filter((d) => d.sessions.length > 0).length,
      other: range.filter((s) => inWeek(s) && !(s.day_id && dayIds.has(s.day_id))).map(toWeekSession),
    };
  });

  const current = weeks[currentWeek - 1]!;
  const weekComplete = endedAt == null && !finished && program.days.length > 0 && current.done === program.days.length;
  return {
    programId: program.id,
    number: Math.max(1, meta?.number ?? 1),
    name: program.name,
    goal: program.goal,
    startedAt: meta?.created_at ?? program.createdAt,
    endedAt,
    endReason: meta?.end_reason ?? null,
    active: meta?.active === 1,
    resumedFrom: meta?.resumed_from ?? null,
    days: program.days,
    currentWeek,
    weekComplete,
    canStartNextWeek: weekComplete && currentWeek < program.weeks,
    finished,
    weeks,
  };
}
