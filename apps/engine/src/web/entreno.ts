/**
 * What the web app's Entreno draws, assembled from the training, workouts and
 * body stores. The page, `GET /api/web/entreno` and the session logger share
 * these shapes. The numbers match the iPhone's plan screen (TrainingPlan.swift).
 */
import type { ExerciseDetail, ExercisePerformance, LoadSuggestion, Muscle, Program, ProgramDay, ProgramExercise, TrainingSession } from "@pulso/contract";
import { listScans } from "../body/store";
import { localDate } from "../daily/dates";
import { ANATOMY } from "../training/anatomy";
import { e1rm } from "../training/math";
import { idsWithMedia, MEDIA_ROUTE, type MediaKind } from "../training/media";
import { activeProgramView, exerciseDetail, exercisePerformance, getExercise, listSessions } from "../training/store";
import { listWorkouts } from "../workouts";
import { activityLabel } from "./today";

// ── Plan arithmetic ──────────────────────────────────────────────────────────

/** Seconds a set takes besides its rest. */
const WORK_SECONDS = 45;
/** Compendium of Physical Activities, resistance training (multiple exercises, 8–15 reps). */
const STRENGTH_MET = 5;
const DAY_MS = 86_400_000;

/** 1-based week since the program was created, clamped to its length. Calendar days on the Mac's clock. */
export function programWeek(program: Pick<Program, "createdAt" | "weeks">, now = new Date()): number {
  const days = Math.round((Date.parse(localDate(now)) - Date.parse(localDate(new Date(program.createdAt)))) / DAY_MS);
  return Math.min(Math.max(Math.floor(days / 7) + 1, 1), Math.max(program.weeks, 1));
}

/**
 * True when a sentence of the notes that mentions a deload names this week:
 * "semana 4 de descarga", "descarga cada 4 semanas", "última semana: descarga".
 */
export function isDeload(week: number, weeks: number, notes: string | null): boolean {
  if (!notes) return false;
  return notes
    .toLowerCase()
    .split(/[.;\n]/)
    .some((sentence) => {
      if (!sentence.includes("descarga") && !sentence.includes("deload")) return false;
      const numbers = (sentence.match(/\d+/g) ?? []).map(Number);
      if (sentence.includes("cada") || sentence.includes("every")) return numbers[0] !== undefined && numbers[0] > 0 && week % numbers[0] === 0;
      if (week === weeks && ["última", "ultima", "last", "final"].some((w) => sentence.includes(w))) return true;
      return numbers.includes(week);
    });
}

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

/** "4 series × 6–8 reps × 32,5 kg", the load only when there is a suggestion. */
export function prescription(ex: Pick<ProgramExercise, "sets" | "repMin" | "repMax">, weightKg: number | null): string {
  const text = `${ex.sets} ${ex.sets === 1 ? "serie" : "series"} × ${reps(ex)} reps`;
  return weightKg && weightKg > 0 ? `${text} × ${kg.format(weightKg)} kg` : text;
}

/** "3 × 6–8 · RIR 2": the short target the logger shows under a name. */
export function target(ex: Pick<ProgramExercise, "sets" | "repMin" | "repMax" | "targetRir" | "targetRpe">): string {
  const effort = ex.targetRir != null ? ` · RIR ${ex.targetRir}` : ex.targetRpe != null ? ` · RPE ${kg.format(ex.targetRpe)}` : "";
  return `${ex.sets} × ${reps(ex)}${effort}`;
}

/** Load step for the logger's arrow keys: dumbbells and bodyweight load move by 1 kg, plates and stacks by 2.5. */
export const weightStep = (equipment: ProgramExercise["equipment"]) => (equipment === "dumbbell" || equipment === "bodyweight" ? 1 : 2.5);

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
  step: number;
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

export type HistoryExercise = { exerciseId: string; name: string; record: boolean; sets: { weightKg: number; reps: number; rpe: number | null }[] };

export type HistoryEntry = {
  id: string;
  kind: "session" | "workout";
  /** Spanish, ready to show */
  title: string;
  startedAt: number;
  endedAt: number;
  /** "18 series · 6.240 kg", "320 kcal · 5,2 km" */
  summary: string | null;
  /** sessions: what was lifted, in the order it was done */
  exercises: HistoryExercise[];
  /** workouts: who recorded it */
  source: string | null;
  energy: number | null;
  distanceKm: number | null;
};

export type EntrenoOverview = {
  program: ProgramHeader | null;
  nextDayId: string | null;
  days: PlanDay[];
  history: HistoryEntry[];
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

function sessionEntry(session: TrainingSession, records: Set<string>): HistoryEntry {
  const exercises: HistoryExercise[] = [];
  for (const set of session.sets) {
    let ex = exercises.find((e) => e.exerciseId === set.exerciseId);
    if (!ex) {
      ex = { exerciseId: set.exerciseId, name: getExercise(set.exerciseId)?.name ?? set.exerciseId, record: records.has(set.exerciseId), sets: [] };
      exercises.push(ex);
    }
    ex.sets.push({ weightKg: set.weightKg, reps: set.reps, rpe: set.rpe });
  }
  const volume = session.sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0);
  const parts = [`${session.sets.length} ${session.sets.length === 1 ? "serie" : "series"}`, volume > 0 ? `${number.format(Math.round(volume))} kg` : null];
  return { id: session.id, kind: "session", title: session.name, startedAt: session.startedAt, endedAt: session.endedAt, summary: parts.filter(Boolean).join(" · "), exercises, source: "Pulso", energy: null, distanceKm: null };
}

/** Logged sessions and Health workouts, newest first, each with its detail. */
export function trainingHistory(limit = 12, sessions = listSessions(SESSIONS)): HistoryEntry[] {
  const records = sessionRecords(sessions);
  const own = sessions.map((s) => sessionEntry(s, records.get(s.id) ?? new Set()));
  const workouts = listWorkouts(limit).map((w): HistoryEntry => {
    const distanceKm = w.distance != null && w.distance > 0 ? Math.round(w.distance / 10) / 100 : null;
    const parts = [w.energy != null ? `${Math.round(w.energy)} kcal` : null, distanceKm != null ? `${number.format(distanceKm)} km` : null];
    return { id: w.id, kind: "workout", title: activityLabel(w.activity), startedAt: w.startedAt, endedAt: w.endedAt, summary: parts.filter(Boolean).join(" · ") || null, exercises: [], source: w.sourceName ?? "Salud", energy: w.energy, distanceKm };
  });
  return [...own, ...workouts].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export function entrenoOverview(now = new Date()): EntrenoOverview {
  const sessions = listSessions(SESSIONS);
  const history = trainingHistory(12, sessions);
  const view = activeProgramView(now.getTime());
  const program = view.program;
  if (!program) return { program: null, nextDayId: null, days: [], history };

  const week = programWeek(program, now);
  const records = recentRecords(sessions, now.getTime());
  const media = idsWithMedia();
  const weightKg = bodyWeight();
  const days = program.days.map((day, i): PlanDay => ({
    id: day.id,
    name: day.name,
    focus: day.focus,
    weekday: day.weekday,
    number: i + 1,
    tagline: tagline(day, day.id === view.nextDayId, now),
    minutes: dayMinutes(day),
    kcal: dayKcal(day, weightKg),
    exercises: day.exercises.map((ex) => {
      const suggestion = view.suggestions[ex.id] ?? null;
      return {
        ...ex,
        thumbnail: media.has(ex.exerciseId) ? webMediaUrl(ex.exerciseId, "thumbnail") : null,
        primaryMuscles: ANATOMY[ex.exerciseId]?.primary ?? [],
        prescription: prescription(ex, suggestion?.weightKg ?? null),
        target: target(ex),
        suggestion,
        record: records.has(ex.exerciseId),
        step: weightStep(ex.equipment),
      };
    }),
  }));
  return {
    program: { id: program.id, name: program.name, goal: program.goal, weeks: program.weeks, notes: program.notes, week, deload: isDeload(week, program.weeks, program.notes) },
    nextDayId: view.nextDayId,
    days,
    history,
  };
}

// ── One exercise ─────────────────────────────────────────────────────────────

export type ExerciseView = { detail: ExerciseDetail; performance: ExercisePerformance | null };

/** The exercise panel: guide (media through the web route) and performance. */
export function exerciseView(id: string): ExerciseView | undefined {
  const detail = exerciseDetail(id);
  if (!detail) return undefined;
  return {
    detail: { ...detail, media: { ...detail.media, animation: toWeb(detail.media.animation), thumbnail: toWeb(detail.media.thumbnail) } },
    performance: exercisePerformance(id) ?? null,
  };
}
