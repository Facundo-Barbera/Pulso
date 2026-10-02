import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { cardioTargetShape, equipmentEnum, programExerciseShape, programShape, supersetIdShape, weightUnitEnum } from "./inputs";
import { describeLive, editLive, getLive, type LiveOp } from "./live";
import { idsWithMedia } from "./media";
import { similarExercises } from "./similar";
import {
  activeProgramToday,
  activeProgramView,
  createProgram,
  exerciseDetail,
  exerciseHistory,
  getActiveProgram,
  getExercise,
  listExercises,
  listSessions,
  nextDay,
  saveSession,
  setExerciseUnit,
  setSessionAdjustment,
  setTrainingSettings,
  suggestDay,
  trainingSettings,
  TrainingError,
  updateProgramDay,
} from "./store";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Runs a handler, turning caller mistakes into a tool error the model can read and fix. */
async function guard(run: () => unknown) {
  try {
    return json(run());
  } catch (error) {
    if (error instanceof TrainingError) return fail(error.message);
    throw error;
  }
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
    "The exercise library: id, Spanish name, primary muscle (\"cardio\" for cardio), secondary muscles, equipment, kind (compound/isolation/cardio), cardio modality, and hasMedia (the phone shows a demonstration animation for it). Programs and logged sets must use these ids. Filter by muscle (matches primary or secondary), equipment, or a name search.",
    {
      muscle: z.enum(muscles).optional(),
      equipment: equipmentEnum.optional(),
      query: z.string().optional().describe("Substring of the Spanish name or id, e.g. 'remo'."),
    },
    async (filter) =>
      guard(() => {
        const media = idsWithMedia();
        return listExercises(filter).map((e) => ({ ...e, hasMedia: media.has(e.id) }));
      }),
  ),

  tool(
    "get_exercise",
    "One library exercise in full, by library id (from list_exercises): fine-grained primary and secondary muscles, Spanish step-by-step instructions and technique cues, curated YouTube technique videos, whether it has a demonstration animation, and the person's own notes on it. Use it to explain how to do an exercise or to pick a substitute that hits the same muscles.",
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
    "Write a whole training program in one call: days in rotation order, each with prescribed exercises (sets, rep range, target RPE or RIR, rest seconds, notes) and, if wanted, cardio blocks (a cardio exercise with a `cardio` target: duration, heart-rate zone, distance, speed/pace, incline/level, intervals) — mixed in a day or as cardio-only days. Exercise ids must be library ids from list_exercises; respect the person's preferred equipment (get_training_preferences) and, when two exercises would do the same job, prefer the one with hasMedia true, since the phone then shows how to do it. By default it becomes the active program the phone shows in Entreno: a new block. The previous block ends (pass `reason`) but nothing is deleted: its sessions, records and the per-exercise history stay, and load suggestions carry over wherever an exercise repeats, so switching focus never restarts the person from zero. Loads are not prescribed: the app suggests them by double progression from logged sessions. Write names, focus and notes in Spanish. " + SUPERSETS,
    { ...programShape, activate: z.boolean().default(true).describe("Make it the active program.") },
    async ({ activate, ...program }) => guard(() => createProgram(program, activate)),
  ),

  tool(
    "get_active_program",
    "The active program with its days and prescriptions, plus `nextDayId` (the next day not done this program week: pinned to today's weekday, else the one after the last day done this week; null when the week is complete), `blocks` (every program so far, oldest first, the active one last: its weeks with each day done / partial / missed / planned and the sessions behind it; weeks are Monday–Sunday, week 1 being the week of the block's first session), `adjustment` (your review of the next session, when the app noticed a break, low readiness, an injury…) and `suggestions` (next load per program exercise id, kg, on the steps of each exercise's unit: see get_training_preferences). `program` is null when none is active.",
    {},
    async () => guard(() => activeProgramView()),
  ),

  tool(
    "edit_program_day",
    'Rewrite one program day\'s exercise list in its new order: reorder, add, remove, swap or change targets (sets, reps, rest, RIR/RPE, a hand-set weightKg, cardio targets) in one call. Pass the WHOLE list: read it from get_active_program first and keep each exercise\'s `id` so its load history follows; omit `id` for new ones. scope "today" changes only today\'s session of that day ("solo hoy"); "always" changes the program ("para siempre"). Returns the updated active program. Pair or unpair exercises by setting or clearing supersetId (keep it on the others so their supersets survive). ' + SUPERSETS,
    {
      dayId: z.string().describe("Program day id from get_active_program."),
      scope: scope.describe('"today" = solo hoy, "always" = para siempre. When unsure, ask.'),
      exercises: z.array(programExerciseShape.extend({ id: z.string().nullish().describe("Existing program exercise id to keep.") })).min(1).max(20),
    },
    async ({ dayId, scope, exercises }) => guard(() => updateProgramDay(dayId, { scope, exercises })),
  ),

  tool(
    "swap_program_exercise",
    'Replace one exercise with another in the active program, keeping its sets, reps, rest and superset (e.g. "cámbiame las sentadillas por prensa"). `from` is a library id or program exercise id; `to` a library id of the same kind (strength for strength, cardio for cardio) — pick it with find_similar_exercises. scope "always" changes every day that has it (or only `dayId`); "today" changes today\'s session of the next day to train (or `dayId`). Returns the days changed.',
    {
      from: z.string().describe("Library id or program exercise id to replace."),
      to: z.string().describe("Library id to use instead."),
      scope: scope.describe('"today" = solo hoy, "always" = para siempre.'),
      dayId: z.string().optional().describe("Limit to this program day."),
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
        return { scope, to: target.name, days: changed.map((d) => d.name) };
      }),
  ),

  tool(
    "find_similar_exercises",
    "Alternatives to an exercise, best first, scored 0–100: same primary muscle and movement pattern first (cardio: same intensity and impact), then the person's preferred equipment (usually machines). Each comes with short Spanish reasons. Use it before any swap so the replacement keeps the same muscle target; filter by equipment when they ask (\"con máquina\", \"sin barra\").",
    {
      exerciseId: z.string().describe("Library id of the exercise to replace."),
      equipment: z.array(equipmentEnum).optional().describe("Only these equipment types."),
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
    'The person\'s training preferences: preferredEquipment, most preferred first (e.g. ["machine", "cable"]); defaultUnit ("kg" or "lb"); exerciseUnits, the exercises (library id) whose machine or plates use their own unit. Respect the equipment when building or adapting programs and choosing swaps. Every weight in the tools is kg, but speak to the person in each exercise\'s unit (exerciseUnits[id] ?? defaultUnit; 1 lb = 0.45359237 kg): "70 lb", not "31,75 kg".',
    {},
    async () => guard(() => trainingSettings()),
  ),

  tool(
    "set_training_preferences",
    'Save the equipment the person prefers, most preferred first (e.g. "prefiero máquinas" → ["machine", "cable"]; replaces the whole list, [] clears it; alternatives in the app rank by it), and/or the default weight unit for exercises without their own and for totals ("usa libras" → "lb"). Only the fields given change.',
    { preferredEquipment: z.array(equipmentEnum).max(7).optional(), defaultUnit: weightUnitEnum.optional() },
    async (settings) => guard(() => setTrainingSettings(settings)),
  ),

  tool(
    "set_exercise_unit",
    'Set the unit one exercise is shown, typed and suggested in, because its machine or plates use it (e.g. "este press en libras", "el remo en máquina va en libras"). It sticks for every future session and the live one; weights stay stored in kg and pound loads land on 5 lb steps. null makes it follow the default unit again. Returns the preferences.',
    {
      exerciseId: z.string().describe("Library id, e.g. 'remo-maquina'; in a live session the exercise's exerciseId from get_live_session."),
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
    "Logged training sessions, newest first, with every set (exerciseId, weightKg, reps, rpe, setIndex; `segments` lists each load of a set where the load dropped mid-set, top first, weightKg/reps being the top one) and cardio blocks (durationSeconds, distanceKm, avgHr, kcal; cardioMinutes in total). Times are epoch ms. Pass exerciseId to only get sessions that included it.",
    {
      limit: z.number().int().min(1).max(100).default(10),
      exerciseId: z.string().optional(),
    },
    async ({ limit, exerciseId }) => guard(() => listSessions(limit, exerciseId)),
  ),

  tool(
    "exercise_history",
    "One exercise's progress, oldest first: per session the top weight (kg), best Epley e1RM (kg; both from top segments only), total reps and volume (kg×reps, counting every segment of drop sets), plus all-time best e1RM and heaviest load. Use it to judge progress or stalls before changing a program.",
    {
      exerciseId: z.string().describe("Exercise id from list_exercises."),
      limit: z.number().int().min(1).max(200).default(30).describe("Most recent sessions to include."),
    },
    async ({ exerciseId, limit }) =>
      guard(() => {
        const history = exerciseHistory(exerciseId, limit);
        if (!history) throw new TrainingError(`Unknown exercise id: ${exerciseId}. Use ids from list_exercises.`);
        return history;
      }),
  ),

  tool(
    "suggest_next_loads",
    "Next load (kg, on the steps of each exercise's unit; the reason speaks in that unit) and target reps for each exercise of a day of the active program, by double progression: all prescribed sets at the top of the rep range → add one increment; short of the bottom → back off; otherwise same load, one more rep. weightKg is null when the exercise has no history. Defaults to the next day to train.",
    { dayId: z.string().optional().describe("Program day id from get_active_program; omit for the next day.") },
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
    "Record a strength session the person did without the phone (they told you about it). Sets are in order; weightKg is the external load in kg (0 for bodyweight). Returns the saved session and any personal records it set (e1rm, weight, reps). Don't use it for sessions done with the phone: those are logged already.",
    {
      name: z.string().min(1).max(80).describe('Session name in Spanish, e.g. "Pierna".'),
      startedAt: z.string().datetime({ offset: true }).describe("When it started, ISO 8601 with offset."),
      durationMinutes: z.number().int().min(1).max(300),
      dayId: z.string().optional().describe("Program day it corresponds to, if any; moves the rotation forward."),
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
        return saveSession({
          id: randomUUID(),
          programId,
          dayId: programId ? dayId : null,
          name,
          startedAt: start,
          endedAt: end,
          notes: notes ?? null,
          sets: sets.map((s, i) => ({ ...s, rpe: s.rpe ?? null, setIndex: i, doneAt: Math.round(start + step * (i + 1)) })),
        });
      }),
  ),
  tool(
    "set_session_adjustment",
    "Adjust the person's NEXT session of a program day, for that session only (the program stays): less load, fewer sets, reps within the range, a swap, skipping an exercise, or a short cardio warm-up first — or record that it stays as planned (noChange). Use it when reviewing the upcoming workout, or when the person asks to make the next one easier. Guardrails, enforced (a refusal says what to fix): loadPercent from −40 to 0 against what progression suggests, never under 60 % of the last load lifted; at most 2 sets fewer per exercise and never more; reps within the prescribed range; swaps keep the kind (strength for strength); skip at most half the day; one cardio warm-up of up to 15 min (action add, a cardio library id). The person sees `rationale` on the next-workout card and can set the adjustment aside with \"Entrenar normal\". Returns the session as it will be done.",
    {
      dayId: z.string().describe("Program day id from get_active_program (usually nextDayId)."),
      noChange: z.boolean().default(false).describe("True when the plan stays as it is."),
      rationale: z.string().min(1).max(240).describe('ONE calm Spanish sentence, no jargon: what you noticed and what changes. E.g. "Llevas 9 días sin entrenar: hoy un 10 % menos de peso."'),
      changes: z
        .array(
          z.object({
            action: z.enum(["adjust", "swap", "skip", "add"]),
            programExerciseId: z.string().nullish().describe("The day's exercise id (ProgramExercise.id); null for add."),
            loadPercent: z.number().min(-40).max(0).nullish().describe("Load change against progression's suggestion, %."),
            sets: z.number().int().min(1).max(10).nullish(),
            reps: z.number().int().min(1).max(50).nullish(),
            toExerciseId: z.string().nullish().describe("swap: library id instead; add: a cardio library id."),
            cardio: cardioTargetShape.nullish().describe("add: the warm-up's target, e.g. { durationMinutes: 8, zone: 1 }."),
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
