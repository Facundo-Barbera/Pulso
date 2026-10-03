/**
 * Training data as the Coach reads it: one line per exercise or set group,
 * ids kept for edits. Every result stays in the Coach's context for later
 * turns, so these are what the tools return instead of the phone's shapes.
 */
import type { ActiveProgramResponse, CardioTarget, LoadSuggestion, Program, ProgramDay, ProgramExercise, TrainingBlock, TrainingSession } from "@pulso/contract";
import { localDate } from "../daily/dates";

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const day = (ms: number) => localDate(new Date(ms));

function cardioText(c: CardioTarget): string {
  const parts = [
    c.durationMinutes != null && `${c.durationMinutes} min`,
    c.zone != null && `Z${c.zone}`,
    c.distanceKm != null && `${c.distanceKm} km`,
    c.speedKmh != null && `${c.speedKmh} km/h`,
    c.paceMinPerKm != null && `${c.paceMinPerKm} min/km`,
    c.inclinePercent != null && `${c.inclinePercent} % incl.`,
    c.level != null && `nivel ${c.level}`,
    c.intervals && `${c.intervals.rounds}×(${c.intervals.workSeconds} s/${c.intervals.restSeconds} s)`,
  ];
  return parts.filter(Boolean).join(" ");
}

/** `<id> · Press de pecho en máquina (press-pecho-maquina) · 3×8–12 · 90 s · RIR 2 · superserie a · «nota»`. */
export function exerciseLine(e: ProgramExercise): string {
  const rx =
    e.kind === "cardio" && e.cardio
      ? [`cardio ${cardioText(e.cardio)}`]
      : [
          `${e.sets}×${range(e.repMin, e.repMax)}`,
          `${e.restSeconds} s`,
          e.targetRir != null && `RIR ${e.targetRir}`,
          e.targetRpe != null && `RPE ${e.targetRpe}`,
          e.weightKg != null && `${e.weightKg} kg fijado`,
        ];
  return [e.id, `${e.exerciseName} (${e.exerciseId})`, ...rx, e.supersetId && `superserie ${e.supersetId}`, e.notes && `«${e.notes}»`].filter(Boolean).join(" · ");
}

/** A day with one line per exercise. */
export const dayOutline = (d: ProgramDay) => ({
  id: d.id,
  name: d.name,
  focus: d.focus,
  weekday: d.weekday,
  ...(d.overridden ? { soloHoy: true } : {}),
  exercises: d.exercises.map(exerciseLine),
});

/** A program as a few lines per day. */
export const programOutline = (p: Program) => ({ id: p.id, name: p.name, goal: p.goal, weeks: p.weeks, notes: p.notes, days: p.days.map(dayOutline) });

const suggestionLine = (id: string, s: LoadSuggestion) => `${id}: ${s.weightKg == null ? "sin historial" : `${s.weightKg} kg`} × ${s.reps} — ${s.reason}`;

/** The current week of the active block: each day done / partial / missed / planned. */
function weekOf(block: TrainingBlock | undefined) {
  const week = block?.weeks[block.currentWeek - 1];
  if (!block || !week) return null;
  return {
    number: block.currentWeek,
    of: block.weeks.length,
    complete: block.weekComplete,
    finished: block.finished,
    days: week.days.map((d) => `${d.name}: ${d.status}${d.sessions.length ? ` (${d.sessions.map((s) => day(s.startedAt)).join(", ")})` : ""}`),
  };
}

/** `2 · Fuerza base · 2026-08-01 → 2026-09-10 · semana 6 de 6 · «Cambio a recomposición» · <id>`. */
function blockLine(b: TrainingBlock): string {
  return [`${b.number} · ${b.name}`, `${day(b.startedAt)} → ${b.endedAt ? day(b.endedAt) : "hoy"}`, `semana ${b.currentWeek} de ${b.weeks.length}`, b.endReason && `«${b.endReason}»`, b.programId]
    .filter(Boolean)
    .join(" · ");
}

/**
 * get_active_program for the Coach: the program as one line per exercise, this
 * week's progress, earlier blocks in a line each and the next session's review.
 * With `dayId`, that day in full with its next loads; null when it isn't a day of it.
 */
export function activeProgramForCoach(view: ActiveProgramResponse, dayId?: string) {
  const program = view.program;
  if (!program) return { program: null, earlierBlocks: (view.blocks ?? []).map(blockLine) };
  const adjustment = view.adjustment && {
    id: view.adjustment.id,
    dayId: view.adjustment.dayId,
    status: view.adjustment.status,
    noChange: view.adjustment.noChange,
    dismissed: view.adjustment.dismissed,
    rationale: view.adjustment.rationale,
    signals: view.adjustment.signals.map((s) => s.detail),
    changes: view.adjustment.changes,
  };
  if (dayId) {
    const d = program.days.find((x) => x.id === dayId);
    if (!d) return null;
    return {
      program: { id: program.id, name: program.name },
      day: { ...d, exercises: d.exercises.map(({ exerciseName, modality: _modality, ...e }) => ({ ...e, name: exerciseName })) },
      nextLoads: d.exercises.filter((e) => view.suggestions[e.id]).map((e) => suggestionLine(e.id, view.suggestions[e.id]!)),
      isNext: view.nextDayId === d.id,
      ...(adjustment && adjustment.dayId === d.id ? { adjustment } : {}),
    };
  }
  return {
    program: programOutline(program),
    nextDayId: view.nextDayId,
    week: weekOf(view.blocks?.find((b) => b.programId === program.id)),
    earlierBlocks: (view.blocks ?? []).filter((b) => b.programId !== program.id).map(blockLine),
    adjustment,
    hrZones: view.hrZones?.map((z) => `Z${z.zone} ${z.minBpm}–${z.maxBpm}`),
  };
}

/** `40×10, 40×10, 80×5→60×3 @9`: one exercise's sets in a session. */
function setsText(sets: TrainingSession["sets"]): string {
  return sets
    .map((s) => {
      const segs = s.segments && s.segments.length > 1 ? s.segments : [{ weightKg: s.weightKg, reps: s.reps }];
      return segs.map((g) => `${g.weightKg}×${g.reps}`).join("→") + (s.rpe != null ? ` @${s.rpe}` : "");
    })
    .join(", ");
}

/** A session in a few lines: per exercise its sets (kg×reps), cardio blocks, what the Watch recorded. */
export function sessionForCoach(s: TrainingSession) {
  const order = [...new Set(s.sets.map((x) => x.exerciseId))];
  return {
    id: s.id,
    name: s.name,
    date: day(s.startedAt),
    startedAt: s.startedAt,
    minutes: Math.round((s.endedAt - s.startedAt) / 60_000),
    dayId: s.dayId,
    notes: s.notes,
    sets: order.map((id) => `${id}: ${setsText(s.sets.filter((x) => x.exerciseId === id))}`),
    cardio: s.cardio.map(({ doneAt: _doneAt, ...c }) => c),
    cardioMinutes: s.cardioMinutes,
    merged: s.merged,
    recorded: s.recorded,
  };
}
