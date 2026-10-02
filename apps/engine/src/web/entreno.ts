/**
 * What the web app's Entreno draws, assembled from the training, workouts and
 * body stores. The page, `GET /api/web/entreno` and the session logger share
 * these shapes. The numbers match the iPhone's plan screen (TrainingPlan.swift).
 */
import type { ExerciseDetail, ExercisePerformance, JoinCandidate, LoadSuggestion, SessionRecording, Muscle, NextAdjustment, Program, ProgramDay, ProgramExercise, TrainingBlock, TrainingSession, WeightUnit } from "@pulso/contract";
import { listScans } from "../body/store";
import { ANATOMY } from "../training/anatomy";
import { e1rm } from "../training/math";
import { idsWithMedia, MEDIA_ROUTE, type MediaKind } from "../training/media";
import { activeProgramView, exerciseDetail, exercisePerformance, getExercise, getSession, listSessions, trainingSettings, unitOf } from "../training/store";
import { formatWeight, toUnit } from "../training/units";
import { activityLabel, joinableFor, mergeSessions, standaloneWorkouts } from "../workouts-merge";

// ── Plan arithmetic ──────────────────────────────────────────────────────────

/** Seconds a set takes besides its rest. */
const WORK_SECONDS = 45;
/** Compendium of Physical Activities, resistance training (multiple exercises, 8–15 reps). */
const STRENGTH_MET = 5;
const DAY_MS = 86_400_000;

import { isDeload } from "../training/weeks";
export { isDeload };

/** Sets × (rest + work), rounded to 5 minutes, never under 10. */
export function dayMinutes(day: Pick<ProgramDay, "exercises">): number {
  const seconds = day.exercises.reduce((sum, ex) => sum + ex.sets * (ex.restSeconds + WORK_SECONDS), 0);
  return Math.max(10, Math.round(seconds / 60 / 5) * 5);
}

/** MET × kg × hours; null without a body weight. */
export function dayKcal(day: Pick<ProgramDay, "exercises">, weightKg: number | null): number | null {
  if (!weightKg || weightKg <= 0) return null;
  return Math.round((STRENGTH_MET * weightKg * dayMinutes(day)) / 60);
}

const kg = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });
const reps = (ex: Pick<ProgramExercise, "repMin" | "repMax">) => (ex.repMin === ex.repMax ? `${ex.repMin}` : `${ex.repMin}–${ex.repMax}`);

/** "4 series × 6–8 reps × 32,5 kg" (or "× 70 lb" on a pound machine), the load only when there is a suggestion. */
export function prescription(ex: Pick<ProgramExercise, "sets" | "repMin" | "repMax">, weightKg: number | null, unit: WeightUnit = "kg"): string {
  const text = `${ex.sets} ${ex.sets === 1 ? "serie" : "series"} × ${reps(ex)} reps`;
  return weightKg && weightKg > 0 ? `${text} × ${formatWeight(weightKg, unit)}` : text;
}

/** "3 × 6–8 · RIR 2": the short target the logger shows under a name. */
export function target(ex: Pick<ProgramExercise, "sets" | "repMin" | "repMax" | "targetRir" | "targetRpe">): string {
  const effort = ex.targetRir != null ? ` · RIR ${ex.targetRir}` : ex.targetRpe != null ? ` · RPE ${kg.format(ex.targetRpe)}` : "";
  return `${ex.sets} × ${reps(ex)}${effort}`;
}

/**
 * For each session, the exercises whose best estimated 1RM beat every earlier
 * session in `sessions`. A first time doing it is not a record.
 */
export function sessionRecords(sessions: Pick<TrainingSession, "id" | "startedAt" | "sets">[]): Map<string, Set<string>> {
  const best = new Map<string, number>();
  const out = new Map<string, Set<string>>();
  for (const session of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const top = new Map<string, number>();
    for (const set of session.sets) top.set(set.exerciseId, Math.max(top.get(set.exerciseId) ?? 0, e1rm(set.weightKg, set.reps)));
    const records = new Set<string>();
    for (const [id, value] of top) {
      const previous = best.get(id);
      if (value > 0 && previous !== undefined && value > previous) records.add(id);
      best.set(id, Math.max(previous ?? 0, value));
    }
    out.set(session.id, records);
  }
  return out;
}

/** Exercises that set a record in a session of the last `days` days: the plan's trophies. */
export function recentRecords(sessions: Pick<TrainingSession, "id" | "startedAt" | "sets">[], now = Date.now(), days = 14): Set<string> {
  const since = now - days * DAY_MS;
  const bySession = sessionRecords(sessions);
  return new Set(sessions.filter((s) => s.startedAt >= since).flatMap((s) => [...(bySession.get(s.id) ?? [])]));
}

// ── Media through the web app's own route ────────────────────────────────────

export const WEB_MEDIA_ROUTE = "/api/web/entreno/media";
export const webMediaUrl = (exerciseId: string, kind: MediaKind) => `${WEB_MEDIA_ROUTE}/exercises/${exerciseId}/${kind}.gif`;
const toWeb = (url: string | null) => (url ? url.replace(MEDIA_ROUTE, WEB_MEDIA_ROUTE) : null);

// ── The page ─────────────────────────────────────────────────────────────────

export type PlanExercise = ProgramExercise & {
  thumbnail: string | null;
  primaryMuscles: Muscle[];
  /** "4 series × 6–8 reps × 32,5 kg" */
  prescription: string;
  /** "3 × 6–8 · RIR 2" */
  target: string;
  suggestion: LoadSuggestion | null;
  /** a record on it in the last two weeks */
  record: boolean;
  /** what its machine or plates use; loads are shown, typed and stepped in it */
  unit: WeightUnit;
};

export type PlanDay = Omit<ProgramDay, "exercises"> & {
  /** 1-based, "Día 2" */
  number: number;
  /** "Hoy toca · Lunes", "Siguiente", "Miércoles" */
  tagline: string | null;
  minutes: number;
  kcal: number | null;
  exercises: PlanExercise[];
};

export type ProgramHeader = Pick<Program, "id" | "name" | "goal" | "weeks" | "notes"> & { week: number; deload: boolean };

export type HistoryExercise = { exerciseId: string; name: string; record: boolean; unit: WeightUnit; sets: { weightKg: number; reps: number; rpe: number | null }[] };

export type HistoryEntry = {
  id: string;
  kind: "session" | "workout";
  /** Spanish, ready to show */
  title: string;
  startedAt: number;
  endedAt: number;
  /** "18 series · 6.240 kg" (volume in the default unit), "320 kcal · 5,2 km" */
  summary: string | null;
  /** sessions: what was lifted, in the order it was done */
  exercises: HistoryExercise[];
  /** workouts: who recorded it */
  source: string | null;
  energy: number | null;
  distanceKm: number | null;
  /** sessions: Apple Watch workouts were merged in (`recorded`); times span them */
  merged: boolean;
  recorded: SessionRecording | null;
  /** sessions: Health workouts nearby that could be joined ("Unir con…") */
  joinable: JoinCandidate[];
};

export type EntrenoOverview = {
  /** for totals, and exercises without a unit of their own */
  defaultUnit: WeightUnit;
  program: ProgramHeader | null;
  /** null when there is no program or this week is complete */
  nextDayId: string | null;
  days: PlanDay[];
  history: HistoryEntry[];
  /** every block, oldest first, the active one last */
  blocks: TrainingBlock[];
  /** each session a block's week refers to, by id, ready to open */
  sessions: Record<string, HistoryEntry>;
  /** the Coach's review of the next day, when there is one */
  adjustment: NextAdjustment | null;
  /** the next day as the Coach adjusted it, when that applies: starting it uses this */
  adjusted: PlanDay | null;
};

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
/** 1 = Monday … 7 = Sunday, like `ProgramDay.weekday`. */
const isoWeekday = (at: Date) => ((at.getDay() + 6) % 7) + 1;
const number = new Intl.NumberFormat("es");

function tagline(day: ProgramDay, isNext: boolean, now: Date): string | null {
  const next = isNext ? (day.weekday === isoWeekday(now) ? "Hoy toca" : "Siguiente") : null;
  const weekday = day.weekday ? WEEKDAYS[day.weekday % 7] : null;
  return [next, weekday].filter(Boolean).join(" · ") || null;
}

/** The newest weighed scan: only for the kcal estimate. */
const bodyWeight = () => listScans(30).find((s) => s.weight != null)?.weight ?? null;

const SESSIONS = 30;

type Units = { defaultUnit: WeightUnit; exerciseUnits: Record<string, WeightUnit> };
const unitIn = (units: Units, exerciseId: string) => units.exerciseUnits[exerciseId] ?? units.defaultUnit;

function sessionEntry(session: TrainingSession, records: Set<string>, units: Units): HistoryEntry {
  const exercises: HistoryExercise[] = [];
  for (const set of session.sets) {
    let ex = exercises.find((e) => e.exerciseId === set.exerciseId);
    if (!ex) {
      ex = { exerciseId: set.exerciseId, name: getExercise(set.exerciseId)?.name ?? set.exerciseId, record: records.has(set.exerciseId), unit: unitIn(units, set.exerciseId), sets: [] };
      exercises.push(ex);
    }
    ex.sets.push({ weightKg: set.weightKg, reps: set.reps, rpe: set.rpe });
  }
  const volume = session.sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  const total = toUnit(volume, units.defaultUnit);
  const r = session.recorded ?? null;
  const parts = [
    `${session.sets.length} ${session.sets.length === 1 ? "serie" : "series"}`,
    volume > 0 ? `${number.format(Math.round(total))} ${units.defaultUnit}` : null,
    r?.energy != null ? `${Math.round(r.energy)} kcal` : null,
  ];
  return {
    id: session.id,
    kind: "session",
    title: session.name,
    startedAt: r?.startedAt ?? session.startedAt,
    endedAt: r?.endedAt ?? session.endedAt,
    summary: parts.filter(Boolean).join(" · "),
    exercises,
    source: "Pulso",
    energy: r?.energy ?? null,
    distanceKm: r?.distance != null ? Math.round(r.distance / 10) / 100 : null,
    merged: !!session.merged,
    recorded: r,
    joinable: session.joinable ?? [],
  };
}

/** Sessions merged with what Health recorded during them (heart rate included) and what could still be joined. */
function withRecordings(sessions: TrainingSession[]): TrainingSession[] {
  const joinable = joinableFor(sessions);
  return mergeSessions(sessions, { series: true }).map((s) => ({ ...s, joinable: joinable.get(s.id) ?? [] }));
}

/**
 * Logged sessions and Health workouts, newest first, each with its detail.
 * A Health workout recorded during a session is inside that session's entry, not a row of its own.
 */
export function trainingHistory(limit = 12, sessions = listSessions(SESSIONS), units: Units = trainingSettings()): HistoryEntry[] {
  const records = sessionRecords(sessions);
  const own = withRecordings(sessions.slice(0, limit)).map((s) => sessionEntry(s, records.get(s.id) ?? new Set(), units));
  const workouts = standaloneWorkouts(limit).map((w): HistoryEntry => {
    const distanceKm = w.distance != null && w.distance > 0 ? Math.round(w.distance / 10) / 100 : null;
    const parts = [w.energy != null ? `${Math.round(w.energy)} kcal` : null, distanceKm != null ? `${number.format(distanceKm)} km` : null];
    return { id: w.id, kind: "workout", title: activityLabel(w.activity), startedAt: w.startedAt, endedAt: w.endedAt, summary: parts.filter(Boolean).join(" · ") || null, exercises: [], source: w.sourceName ?? "Salud", energy: w.energy, distanceKm, merged: false, recorded: null, joinable: [] };
  });
  return [...own, ...workouts].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export function entrenoOverview(now = new Date()): EntrenoOverview {
  const sessions = listSessions(SESSIONS);
  const units = trainingSettings();
  const history = trainingHistory(12, sessions, units);
  const view = activeProgramView(now.getTime());
  const program = view.program;
  const { defaultUnit } = units;
  const blocks = view.blocks ?? [];
  const records = recentRecords(sessions, now.getTime());
  const referenced = blocks.flatMap((b) => b.weeks.flatMap((w) => [...w.days.flatMap((d) => d.sessions), ...w.other]));
  const known = new Map(sessions.map((s) => [s.id, s]));
  const byId = sessionRecords(sessions);
  const weekSessions = [...new Set(referenced.map((s) => s.id))].flatMap((id) => {
    const session = known.get(id) ?? getSession(id);
    return session ? [session] : [];
  });
  const opened = Object.fromEntries(withRecordings(weekSessions).map((s) => [s.id, sessionEntry(s, byId.get(s.id) ?? new Set(), units)]));
  const shared = { history, blocks, sessions: opened, adjustment: view.adjustment ?? null };
  if (!program) return { defaultUnit, program: null, nextDayId: null, days: [], adjusted: null, ...shared };

  const week = blocks.find((b) => b.programId === program.id)?.currentWeek ?? 1;
  const media = idsWithMedia();
  const weightKg = bodyWeight();
  const planDay = (day: ProgramDay, i: number, suggestions: Record<string, LoadSuggestion>): PlanDay => ({
    id: day.id,
    name: day.name,
    focus: day.focus,
    weekday: day.weekday,
    number: i + 1,
    tagline: tagline(day, day.id === view.nextDayId, now),
    minutes: dayMinutes(day),
    kcal: dayKcal(day, weightKg),
    exercises: day.exercises.map((ex) => {
      const suggestion = suggestions[ex.id] ?? null;
      const unit = unitIn(units, ex.exerciseId);
      return {
        ...ex,
        thumbnail: media.has(ex.exerciseId) ? webMediaUrl(ex.exerciseId, "thumbnail") : null,
        primaryMuscles: ANATOMY[ex.exerciseId]?.primary ?? [],
        prescription: prescription(ex, suggestion?.weightKg ?? null, unit),
        target: target(ex),
        suggestion,
        record: records.has(ex.exerciseId),
        unit,
      };
    }),
  });
  const days = program.days.map((day, i) => planDay(day, i, view.suggestions));
  const adjustment = view.adjustment ?? null;
  const applies = adjustment && adjustment.status === "ready" && !adjustment.noChange && !adjustment.dismissed && adjustment.changes.length > 0;
  const adjusted = applies ? planDay(adjustment.day, program.days.findIndex((d) => d.id === adjustment.dayId), adjustment.suggestions) : null;
  return {
    defaultUnit,
    program: { id: program.id, name: program.name, goal: program.goal, weeks: program.weeks, notes: program.notes, week, deload: isDeload(week, program.weeks, program.notes) },
    nextDayId: view.nextDayId,
    days,
    adjusted,
    ...shared,
  };
}

// ── One exercise ─────────────────────────────────────────────────────────────

export type ExerciseView = { detail: ExerciseDetail; performance: ExercisePerformance | null; unit: WeightUnit };

/** The exercise panel: guide (media through the web route) and performance. */
export function exerciseView(id: string): ExerciseView | undefined {
  const detail = exerciseDetail(id);
  if (!detail) return undefined;
  return {
    detail: { ...detail, media: { ...detail.media, animation: toWeb(detail.media.animation), thumbnail: toWeb(detail.media.thumbnail) } },
    performance: exercisePerformance(id) ?? null,
    unit: unitOf(id),
  };
}
