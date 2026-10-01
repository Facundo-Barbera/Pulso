import type { AdjustmentSignal, Program, ProgramDay, TrainingBlock } from "@pulso/contract";
import { listHealthEvents } from "../calendar/store";
import { addDays, localDate } from "../daily/dates";
import { readinessFor } from "../daily/store";
import { db } from "../db";

/**
 * What the engine notices before the next workout. It only detects: each
 * signal sends the session to the Coach for review (./review.ts), and the
 * Coach decides what, if anything, changes. Thresholds are relative to the
 * person's own rhythm, not a fixed number of days: two days off is ordinary
 * rest in a four-day week.
 */
export const TRIGGERS = {
  /** A gap up to this many times the person's usual one is ordinary rest… */
  usualFactor: 1.5,
  /** …and under this many days never counts as a break. */
  moderateDays: 7,
  longDays: 14,
  veryLongDays: 28,
  /** After a very long break, the sessions back (counting the first) that still ease in. */
  returningSessions: 3,
  /** One exercise, usually trained about weekly: not done for this long is worth a look. */
  exerciseModerateDays: 14,
  exerciseLongDays: 28,
  /** The latest sessions whose gaps set the usual rhythm (median gap). */
  rhythmSessions: 9,
  /** A health event over this recently still counts. */
  healthRecentDays: 7,
  /** A block this new, without a session of its own yet, is a switch. */
  blockSwitchDays: 14,
  /** Days missed last week that are worth a look. */
  missedDays: 2,
};

const LEVELS = ["moderate", "long", "very_long"] as const;
type Level = (typeof LEVELS)[number];
const rank = (level: string | null | undefined) => LEVELS.indexOf(level as Level);

/** Whole calendar days from `from` to `to`, on the Mac's clock. */
export function daysBetween(from: number, to: number): number {
  return Math.round((Date.parse(localDate(new Date(to))) - Date.parse(localDate(new Date(from)))) / 86_400_000);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Days the person usually takes between sessions: the median gap of the
 * latest sessions, or the program's own rhythm (7 / days a week) without
 * enough history. Never under one day.
 */
export function usualGap(startedAt: number[], daysPerWeek: number): number {
  const times = [...startedAt].sort((a, b) => b - a).slice(0, TRIGGERS.rhythmSessions);
  const gaps = times.slice(1).map((t, i) => (times[i]! - t) / 86_400_000);
  const usual = gaps.length >= 3 ? median(gaps) : 7 / Math.min(7, Math.max(1, daysPerWeek));
  return Math.max(1, usual);
}

/** The break band for `days` off against a usual gap; null when it is ordinary rest. */
export function breakLevel(days: number, usual: number): Level | null {
  if (days >= TRIGGERS.veryLongDays) return "very_long";
  if (days >= TRIGGERS.longDays) return "long";
  if (days >= Math.max(TRIGGERS.moderateDays, TRIGGERS.usualFactor * usual)) return "moderate";
  return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A signal plus what identifies it for dedupe (an exercise, a health event). */
export type Detected = AdjustmentSignal & { ref: string };

/**
 * The signals for the next workout, `day` of `program`, as of `now`. `blocks`
 * are every block (oldest first, the program's last): for the switch and
 * missed days.
 */
export function detectSignals(program: Program, day: ProgramDay, blocks: TrainingBlock[], now = Date.now()): Detected[] {
  const out: Detected[] = [];
  const times = db().query<{ started_at: number }, []>("SELECT started_at FROM training_sessions ORDER BY started_at DESC").all().map((r) => r.started_at);
  const usual = usualGap(times, program.days.length);
  let overall: Level | null = null;

  if (times.length > 0) {
    const off = daysBetween(times[0]!, now);
    overall = breakLevel(off, usual);
    if (overall) {
      out.push({ kind: "inactivity", level: overall, days: off, ref: "", detail: `Llevas ${plural(off, "día", "días")} sin entrenar (sueles descansar ${plural(Math.round(usual), "día", "días")})` });
    } else {
      // Back from a very long break: the first sessions still ease in.
      const back = times.findIndex((t, i) => i + 1 < times.length && daysBetween(times[i + 1]!, t) >= TRIGGERS.veryLongDays);
      if (back !== -1 && back + 1 < TRIGGERS.returningSessions) {
        const gap = daysBetween(times[back + 1]!, times[back]!);
        out.push({ kind: "inactivity", level: "returning", days: gap, ref: "", detail: `Vuelves de ${plural(gap, "día", "días")} sin entrenar: ${plural(back + 1, "sesión", "sesiones")} desde entonces` });
      }
    }
  }

  for (const ex of day.exercises) {
    if (ex.kind === "cardio") continue;
    const last = db()
      .query<{ at: number }, [string]>("SELECT MAX(t.started_at) AS at FROM set_logs s JOIN training_sessions t ON t.id = s.session_id WHERE s.exercise_id = ?")
      .get(ex.exerciseId)?.at;
    if (!last) continue;
    const days = daysBetween(last, now);
    const level: Level | null = days >= TRIGGERS.exerciseLongDays ? "long" : days >= TRIGGERS.exerciseModerateDays ? "moderate" : null;
    if (level && rank(level) > rank(overall)) {
      out.push({ kind: "exercise_gap", level, days, programExerciseId: ex.id, ref: ex.id, detail: `${ex.exerciseName}: ${plural(days, "día", "días")} sin hacerlo` });
    }
  }

  const today = localDate(new Date(now));
  const readiness = readinessFor(today);
  const sleep = readiness.factors.find((f) => f.key === "sleep");
  if (readiness.level === "low") {
    out.push({ kind: "readiness", level: "low", days: null, ref: "", detail: readiness.explanation });
  } else if (sleep?.score != null && sleep.score <= 40) {
    out.push({ kind: "readiness", level: "sleep", days: null, ref: "", detail: `Dormiste poco: ${sleep.detail}` });
  }

  const recent = addDays(today, -TRIGGERS.healthRecentDays);
  for (const event of listHealthEvents({ to: today })) {
    if (event.status === "resuelta" && (event.endDate ?? today) < recent) continue;
    const limits = event.affectedTraining ? ` (${event.affectedTraining})` : "";
    const state = event.status === "resuelta" ? "resuelta hace poco" : event.status === "recuperandose" ? "recuperándote" : "activa";
    out.push({ kind: "health_event", level: event.status, days: null, ref: event.id, detail: `${event.title}${limits}: ${state}` });
  }

  const block = blocks.find((b) => b.programId === program.id);
  const previous = blocks.filter((b) => b.programId !== program.id && b.endedAt != null).at(-1);
  const ownSessions = block?.weeks.some((w) => w.days.some((d) => d.sessions.length > 0)) ?? false;
  if (block && previous && !ownSessions && now - (previous.endedAt ?? 0) <= TRIGGERS.blockSwitchDays * 86_400_000) {
    out.push({ kind: "block_switch", level: null, days: null, ref: previous.programId, detail: `Primera sesión de ${block.name} (antes: ${previous.name})` });
  }

  const lastWeek = block && !block.finished ? block.weeks[block.currentWeek - 2] : undefined;
  const missed = lastWeek?.days.filter((d) => d.status === "missed").length ?? 0;
  if (missed >= TRIGGERS.missedDays) {
    out.push({ kind: "missed_sessions", level: null, days: missed, ref: String(lastWeek!.number), detail: `La semana pasada quedaron ${plural(missed, "día", "días")} sin hacer` });
  }
  return out;
}

/** The same signals give the same key, so one upcoming session is reviewed once per situation. */
export function signalsKey(programId: string, dayId: string, since: string, signals: Detected[]): string {
  const parts = signals.map((s) => `${s.kind}:${s.level ?? ""}:${s.ref}`).sort();
  return [programId, dayId, since, ...parts].join("|");
}

/** Signals as stored and shown, without the dedupe ref. */
export const publicSignals = (signals: Detected[]): AdjustmentSignal[] => signals.map(({ ref: _ref, ...s }) => s);
