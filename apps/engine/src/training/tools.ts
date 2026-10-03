import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { withCard } from "../agent/card";
import { listMergedSessions } from "../workouts-merge";
import { activeProgramForCoach, dayOutline, programOutline, sessionForCoach } from "./coach-view";
import { cardioTargetShape, equipmentEnum, programExerciseShape, programShape, supersetIdShape, weightUnitEnum } from "./inputs";
import { describeLive, editLive, getLive, type LiveOp } from "./live";
import { idsWithMedia } from "./media";
import { similarExercises } from "./similar";
import {
  activeProgramToday,
  activeProgramView,
  createProgram,
  daysFingerprint,
  exerciseDetail,
  exerciseHistory,
  getActiveProgram,
  getExercise,
  listExercises,
  nextDay,
  saveSession,
  setExerciseUnit,
  setSessionAdjustment,
  setTrainingSettings,
  snapshotProgramDays,
  suggestDay,
  trainingSettings,
  TrainingError,
  updateProgramDay,
  updateProgramDays,
} from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Runs a handler, turning caller mistakes into a tool error the model can read and fix. A handler may return its own result (withCard). */
async function guard(run: () => unknown) {
  try {
    const value = run();
    return value instanceof Carded ? withCard(value.model, value.card) : json(value);
  } catch (error) {
    if (error instanceof TrainingError) return fail(error.message);
    throw error;
  }
}

/** What the model reads, and the fuller value its action card is built from. */
class Carded {
  constructor(
    readonly model: unknown,
    readonly card: unknown,
  ) {}
}

/** The card of a program change: which days, and how they look right after it (Deshacer checks nothing changed since). */
function programCard(scope: "today" | "always", dayIds: string[]) {
  const after = snapshotProgramDays(dayIds);
  const program = activeProgramToday();
  return {
    programId: program?.id,
    name: program?.name,
    scope,
    days: program?.days.filter((d) => dayIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, exercises: d.exercises.length })),
    after: after ? daysFingerprint(after) : null,
  };
}

const muscles = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "core", "full_body", "cardio"] as const;
const scope = z.enum(["today", "always"]);
const exerciseRef = z
  .union([z.literal("current"), z.number().int().min(1), z.string()])
  .describe('"current" (the exercise on screen), its 1-based position, or its live id / library id from get_live_session.');

/** One change to the session in progress. */
const liveOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("swap"), exercise: exerciseRef, toExerciseId: z.string().describe("Library id to do instead (same muscle target).") }),
  z.object({
    op: z.literal("update"),
    exercise: exerciseRef,
    sets: z.number().int().min(1).max(10).optional().describe("Total sets; sets already done are kept."),
    repMin: z.number().int().min(1).max(50).optional(),
    repMax: z.number().int().min(1).max(50).optional(),
    weightKg: z.number().min(0).max(1000).optional().describe("Load for the sets not done yet, kg (convert from the exercise's unit; it lands on that unit's steps)."),
    reps: z.number().int().min(1).max(50).optional().describe("Reps for the sets not done yet."),
    restSeconds: z.number().int().min(0).max(600).optional(),
    cardio: cardioTargetShape.optional().describe("Cardio blocks: the target fields to change."),
    supersetId: supersetIdShape.describe(
      'Pair it into a superset: give the same label (e.g. "a") to 2+ consecutive strength exercises, one update each, in the same call. null takes it out of its superset.',
    ),
  }),
  z.object({
    op: z.literal("add"),
    exerciseId: z.string(),
    position: z.number().int().min(1).optional().describe("1-based; omit to add at the end."),
    sets: z.number().int().min(1).max(10).optional(),
    repMin: z.number().int().min(1).max(50).optional(),
    repMax: z.number().int().min(1).max(50).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
    weightKg: z.number().min(0).max(1000).optional(),
    cardio: cardioTargetShape.optional().describe("For a cardio exercise; defaults to 15 min in zone 2."),
    supersetId: supersetIdShape.describe("Join the superset of its neighbours with this label (add it right next to them)."),
  }),
  z.object({ op: z.literal("remove"), exercise: exerciseRef }),
  z.object({ op: z.literal("skip"), exercise: exerciseRef }),
  z.object({ op: z.literal("move"), exercise: exerciseRef, to: z.number().int().min(1).describe("New 1-based position.") }),
  z.object({ op: z.literal("focus"), exercise: exerciseRef }),
  z.object({
    op: z.literal("finish_cardio"),
    exercise: exerciseRef,
    reason: z.string().max(200).optional().describe('Short Spanish note, e.g. "Cansado".'),
  }),
  z.object({
    op: z.literal("drop"),
    exercise: exerciseRef.optional().describe("Omit for the set done last in the session."),
    set: z.number().int().min(1).optional().describe("1-based set of `exercise` (needs exercise); omit for its last done set."),
    weightKg: z.number().min(0).max(1000).describe("The lighter load they finished with, kg (convert from the exercise's unit; it lands on that unit's steps)."),
    reps: z.number().int().min(1).max(50).describe("Reps done at that load."),
  }),
]);

/** How supersets work, shared by the tools that write them. */
const SUPERSETS =
  'Supersets ("superseries"): give the same supersetId (any short label, e.g. "a") to 2+ consecutive strength exercises; the person does one set of each in turn (A, B, rest, A, B, rest…), resting only after the last of the group. Members must be next to each other; a lone or separated member, or a cardio block, loses its supersetId.';

/** Finds a program exercise by its id or library id in a day. */
const findIn = (day: { exercises: { id: string; exerciseId: string }[] }, from: string) => day.exercises.findIndex((e) => e.id === from || e.exerciseId === from);

export const trainingTools = [
  tool(
    "list_exercises",
    "The exercise library: id, Spanish name, primary muscle (\"cardio\" for cardio), secondary muscles, equipment, kind, cardio modality, hasMedia (the phone shows a demo). Programs and sets use these ids. muscle matches primary or secondary.",
    {
      muscle: z.enum(muscles).optional(),
      equipment: equipmentEnum.optional(),
      query: z.string().optional().describe("Part of the Spanish name or id, e.g. 'remo'."),
    },
    async (filter) =>
      guard(() => {
        const media = idsWithMedia();
        return listExercises(filter).map((e) => ({ ...e, hasMedia: media.has(e.id) }));
      }),
  ),

  tool(
    "get_exercise",
    "One library exercise in full: detailed muscles, Spanish step-by-step instructions and cues, YouTube technique videos, hasMedia, and the person's notes on it.",
    { exerciseId: z.string().describe("Library id, e.g. 'press-banca'.") },
    async ({ exerciseId }) =>
      guard(() => {
        const detail = exerciseDetail(exerciseId);
        if (!detail) throw new TrainingError(`Unknown exercise id: ${exerciseId}. Use ids from list_exercises.`);
        return detail;
      }),
  ),

  tool(
    "create_program",
    "Write a whole training program: days in rotation order with prescribed exercises and, if wanted, cardio blocks (a cardio exercise with a `cardio` target), mixed or as cardio-only days. Between equivalent exercises prefer hasMedia true (the phone shows how). By default it becomes the active program, a new block: the previous one ends (pass `reason`), its sessions, records and history stay, and loads carry over where exercises repeat. Loads aren't prescribed: the app suggests them by double progression.",
    { ...programShape, activate: z.boolean().default(true) },
    async ({ activate, ...program }) =>
      guard(() => {
        const created = createProgram(program, activate);
        return new Carded(programOutline(created), created);
      }),
  ),

  tool(
    "get_active_program",
    "The active program (`program` null if none), compact: per day id, name and one line per exercise («<program exercise id> · name (library id) · sets×reps · rest · RIR/RPE · hand-set load · superserie · «notes»»; cardio gives its target); `soloHoy` on a day changed only today; `nextDayId` (next day not done this week: today's pinned one, else after the last done; null when complete); `week` (each day done/partial/missed/planned, Mon–Sun); `earlierBlocks` (dates, weeks, why it ended, id); `adjustment` (your review of the next session). " +
      "`dayId` gives that day in full, with each exercise's next load (kg, on its unit's steps, with the reason).",
    { dayId: z.string().optional() },
    async ({ dayId }) =>
      guard(() => {
        const view = activeProgramForCoach(activeProgramView(), dayId);
        if (view === null) throw new TrainingError(`Day ${dayId} is not in the active program.`);
        return view;
      }),
  ),

  tool(
    "edit_program_days",
    "Rewrite the exercise lists of one or more program days in ONE call, all or nothing: reorder, add, remove, swap or change targets. A change touching several days (\"hazla más corta\", \"solo máquinas\") is one call with all of them. Pass each day's WHOLE new list from get_active_program, keeping each exercise's `id` so its history follows (omit for new ones) and the supersetId of the others. Returns the edited days, one line per exercise.",
    {
      scope: scope.describe('"today" = solo hoy (today\'s session of those days), "always" = para siempre.'),
      days: z
        .array(
          z.object({
            dayId: z.string(),
            exercises: z.array(programExerciseShape.extend({ id: z.string().nullish().describe("Program exercise id to keep.") })).min(1).max(20),
          }),
        )
        .min(1)
        .max(7),
    },
    async ({ scope, days }) =>
      guard(() => {
        const program = updateProgramDays(days, scope);
        const ids = days.map((d) => d.dayId);
        const edited = program.days.filter((d) => ids.includes(d.id));
        return new Carded({ program: program.name, scope, days: edited.map(dayOutline) }, programCard(scope, ids));
      }),
  ),

  tool(
    "swap_program_exercise",
    'Replace one exercise in the active program, keeping its sets, reps, rest and superset. `to` is a library id of the same kind (strength or cardio), from find_similar_exercises. scope "always": every day that has it; "today": today\'s session of the next day to train; `dayId` limits either to that day. Returns the days changed.',
    {
      from: z.string().describe("Library id or program exercise id."),
      to: z.string(),
      scope: scope.describe('"today" = solo hoy, "always" = para siempre.'),
      dayId: z.string().optional(),
    },
    async ({ from, to, scope, dayId }) =>
      guard(() => {
        // "always" edits the program itself, never today's one-off list.
        const program = scope === "always" ? getActiveProgram() : activeProgramToday();
        if (!program) throw new TrainingError("There is no active program.");
        const target = getExercise(to);
        if (!target) throw new TrainingError(`Unknown exercise id: ${to}. Use ids from list_exercises.`);
        const days = dayId ? program.days.filter((d) => d.id === dayId) : scope === "today" ? [nextDay(program)!].filter(Boolean) : program.days;
        if (dayId && days.length === 0) throw new TrainingError(`Day ${dayId} is not in the active program.`);
        const changed = days.filter((d) => findIn(d, from) !== -1);
        if (changed.length === 0) throw new TrainingError(`${from} is not in ${dayId || scope === "today" ? "that day" : "the active program"}. Check ids with get_active_program.`);
        for (const day of changed) {
          const exercises = day.exercises.map((e, i) => ({ ...e, exerciseId: i === findIn(day, from) ? to : e.exerciseId }));
          updateProgramDay(day.id, { scope, exercises });
        }
        const result = { scope, to: target.name, days: changed.map((d) => d.name) };
        return new Carded(result, { to: result.to, ...programCard(scope, changed.map((d) => d.id)) });
      }),
  ),

  tool(
    "find_similar_exercises",
    "Alternatives to an exercise, best first, scored 0–100: same primary muscle and movement pattern (cardio: intensity and impact), then preferred equipment; with short Spanish reasons. Filter by equipment when they ask (\"con máquina\").",
    {
      exerciseId: z.string().describe("Library id to replace."),
      equipment: z.array(equipmentEnum).optional(),
      limit: z.number().int().min(1).max(30).default(8),
    },
    async ({ exerciseId, equipment, limit }) =>
      guard(() => {
        const list = similarExercises(exerciseId, { equipment, limit });
        if (!list) throw new TrainingError(`Unknown exercise id: ${exerciseId}. Use ids from list_exercises.`);
        return list.map(({ id, name, muscle, equipment, kind, score, reasons, preferred }) => ({ id, name, muscle, equipment, kind, score, reasons, preferred }));
      }),
  ),

  tool(
    "get_training_preferences",
    'Training preferences: preferredEquipment (best first), defaultUnit (kg or lb), exerciseUnits (library ids whose machine or plates use their own unit). Tools use kg, but speak in each exercise\'s unit (exerciseUnits[id] ?? defaultUnit; 1 lb = 0.45359237 kg): "70 lb", not "31,75 kg".',
    {},
    async () => guard(() => trainingSettings()),
  ),

  tool(
    "set_training_preferences",
    'Save preferredEquipment, best first ("prefiero máquinas" → ["machine", "cable"]; replaces the list, [] clears it), and/or defaultUnit, for exercises without their own and totals. Only the fields given change.',
    { preferredEquipment: z.array(equipmentEnum).max(7).optional(), defaultUnit: weightUnitEnum.optional() },
    async (settings) => guard(() => setTrainingSettings(settings)),
  ),

  tool(
    "set_exercise_unit",
    'Set the unit one exercise is shown, typed and suggested in, because its machine or plates use it ("este press en libras"), for future sessions and the live one. Stored in kg; lb loads land on 5 lb steps. null = follow the default. Returns the preferences.',
    {
      exerciseId: z.string().describe("Library id (in a live session, its exerciseId)."),
      unit: weightUnitEnum.nullable(),
    },
    async ({ exerciseId, unit }) => guard(() => setExerciseUnit(exerciseId, unit)),
  ),

  tool(
    "get_live_session",
    "The strength/cardio session the person is doing right now on the phone, or null: each exercise with its position, live id, library id, sets (weightKg and reps of the top segment, `segments` when the load dropped mid-set, done or not), cardio target, skipped flag, cutShort (cardio ended early), supersetId (exercises sharing one are done as a superset), `focus` (index of the one on screen) and `cardioClock` (the running cardio timer: elapsed = accumulatedSeconds + now − runningSince; the summary has it in minutes). Use it before edit_live_session.",
    {},
    async () =>
      guard(() => {
        const session = getLive();
        return session ? { summary: describeLive(session), session } : { session: null };
      }),
  ),

  tool(
    "edit_live_session",
    'Change the session in progress right now — today only, the program stays as is. Ops run in order, all or nothing: swap (another exercise for the same target; done sets stay logged under the old one; the new one keeps its superset), update (sets, reps, load for the sets not done, rest, cardio target, supersetId to pair/unpair), add (strength or cardio, at a position, optionally into a superset), remove (only if nothing was logged; else skip), skip, move (reorder), focus (show it), finish_cardio (end a cardio block early, keeping the minutes done: it counts as done, not skipped; the phone stops its timer), drop (they lowered the load mid-set to finish it, "bajé a 60 para terminar 3 más": adds that load × reps as one more segment of the set they just did, shown "80 kg × 5 → 60 kg × 3"; volume counts it, records and next loads read only the top segment). A cardio block with time on its running clock cannot be skipped, removed or swapped: finish_cardio it first. The phone shows the change at once with an undo. Returns the updated session and one line per change. ' +
      SUPERSETS +
      " To pair two exercises, update both with the same supersetId in one call (move them next to each other first if needed); a pairing that can't stand is refused. A move, remove or skip that leaves a member alone or apart takes it out of its superset.",
    { ops: z.array(liveOp).min(1).max(10) },
    async ({ ops }) =>
      guard(() => {
        const { session, changes } = editLive(ops as LiveOp[]);
        return { changes, summary: describeLive(session) };
      }),
  ),

  tool(
    "list_sessions",
    "Logged training sessions, newest first: date, minutes, dayId, per exercise one line of sets in order, kg×reps (\"80×5→60×3\" = load dropped mid-set, the first is the top segment; \"@9\" = RPE); cardio blocks (durationSeconds, distanceKm, avgHr, kcal; cardioMinutes total). startedAt epoch ms. exerciseId: only sessions with it. " +
      "merged: true = Apple Watch (or another Health app) recorded workouts during it, in `recorded` (parts, kcal summed once, avg/max HR, distance, span): NOT extra training, never add them again from list_workouts. A cardio block with `recordedBy` was filled in from that workout.",
    {
      limit: z.number().int().min(1).max(100).default(10),
      exerciseId: z.string().optional(),
    },
    async ({ limit, exerciseId }) => guard(() => listMergedSessions(limit, exerciseId).map(sessionForCoach)),
  ),

  tool(
    "exercise_history",
    "One exercise's progress, oldest first: per session top weight and best Epley e1RM (kg, top segments only), total reps and volume (kg×reps, every drop-set segment), plus all-time best e1RM and heaviest load.",
    {
      exerciseId: z.string().describe("Library id."),
      limit: z.number().int().min(1).max(200).default(30).describe("Most recent sessions."),
    },
    async ({ exerciseId, limit }) =>
      guard(() => {
        const history = exerciseHistory(exerciseId, limit);
        if (!history) throw new TrainingError(`Unknown exercise id: ${exerciseId}. Use ids from list_exercises.`);
        return { ...history, points: history.points.map(({ sets: _sets, ...point }) => point) };
      }),
  ),

  tool(
    "suggest_next_loads",
    "Next load (kg, on the steps of each exercise's unit; the reason speaks in that unit) and target reps for each exercise of an active program day, by double progression: every set at the top of the range → one increment up; short of the bottom → back off; else same load, one more rep. weightKg null without history.",
    { dayId: z.string().optional().describe("Default the next day to train.") },
    async ({ dayId }) =>
      guard(() => {
        const program = getActiveProgram();
        if (!program) throw new TrainingError("There is no active program. Create one with create_program.");
        const day = dayId ? program.days.find((d) => d.id === dayId) : nextDay(program);
        if (!day) throw new TrainingError(`Day ${dayId} is not in the active program.`);
        return { dayId: day.id, dayName: day.name, suggestions: suggestDay(day) };
      }),
  ),

  tool(
    "log_session",
    "Record a strength session done without the phone (sessions done with the phone are logged already). Sets in order; weightKg is the external load (0 for bodyweight). Returns the saved session and any records it set.",
    {
      name: z.string().min(1).max(80).describe('Spanish, e.g. "Pierna".'),
      startedAt: z.string().datetime({ offset: true }).describe("ISO 8601 with offset."),
      durationMinutes: z.number().int().min(1).max(300),
      dayId: z.string().optional().describe("Program day it was, if any; moves the rotation forward."),
      notes: z.string().max(1000).optional(),
      sets: z
        .array(
          z.object({
            exerciseId: z.string(),
            weightKg: z.number().min(0).max(1000),
            reps: z.number().int().min(1).max(200),
            rpe: z.number().min(1).max(10).optional(),
          }),
        )
        .min(1)
        .max(300),
    },
    async ({ name, startedAt, durationMinutes, dayId, notes, sets }) =>
      guard(() => {
        const start = Date.parse(startedAt);
        const end = start + durationMinutes * 60_000;
        const active = dayId ? getActiveProgram() : undefined;
        const programId = active?.days.some((d) => d.id === dayId) ? active.id : null;
        // Spread set times across the session so history keeps their order.
        const step = (end - start) / sets.length;
        const saved = saveSession({
          id: randomUUID(),
          programId,
          dayId: programId ? dayId : null,
          name,
          startedAt: start,
          endedAt: end,
          notes: notes ?? null,
          sets: sets.map((s, i) => ({ ...s, rpe: s.rpe ?? null, setIndex: i, doneAt: Math.round(start + step * (i + 1)) })),
        });
        return new Carded({ session: sessionForCoach(saved.session), prs: saved.prs }, saved);
      }),
  ),
  tool(
    "set_session_adjustment",
    "Adjust only the NEXT session of a program day (the program stays): less load, fewer sets, reps within the range, a swap, a skip, or a short cardio warm-up first; or noChange to record it stays as planned. Enforced (a refusal says what to fix): loadPercent −40 to 0 vs progression, never under 60 % of the last load; at most 2 fewer sets, never more; reps within range; swaps keep the kind; skip at most half the day; one cardio warm-up ≤ 15 min (add). The person sees `rationale` on the next-workout card and can dismiss it (\"Entrenar normal\"). Returns the session as it will be done.",
    {
      dayId: z.string().describe("Usually nextDayId (get_active_program)."),
      noChange: z.boolean().default(false),
      rationale: z.string().min(1).max(240).describe('ONE calm Spanish sentence: what you noticed and what changes, e.g. "Llevas 9 días sin entrenar: hoy un 10 % menos de peso."'),
      changes: z
        .array(
          z.object({
            action: z.enum(["adjust", "swap", "skip", "add"]),
            programExerciseId: z.string().nullish().describe("The day's exercise id; null for add."),
            loadPercent: z.number().min(-40).max(0).nullish().describe("% vs progression's suggestion."),
            sets: z.number().int().min(1).max(10).nullish(),
            reps: z.number().int().min(1).max(50).nullish(),
            toExerciseId: z.string().nullish().describe("swap: library id; add: a cardio library id."),
            cardio: cardioTargetShape.nullish().describe("add: e.g. { durationMinutes: 8, zone: 1 }."),
          }),
        )
        .max(20)
        .default([]),
    },
    async ({ dayId, noChange, rationale, changes }) =>
      guard(() => {
        const adjusted = setSessionAdjustment({ dayId, noChange, rationale, changes: changes.map((c) => ({ ...c, programExerciseId: c.programExerciseId ?? null })) });
        return { id: adjusted.id, dayId: adjusted.dayId, noChange: adjusted.noChange, rationale: adjusted.rationale, exercises: adjusted.day.exercises.map((e) => ({ id: e.id, name: e.exerciseName, sets: e.sets, suggestion: adjusted.suggestions[e.id] ?? null })) };
      }),
  ),
];
