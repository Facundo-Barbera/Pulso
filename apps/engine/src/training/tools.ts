import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { programShape } from "./inputs";
import {
  activeProgramView,
  createProgram,
  exerciseHistory,
  getActiveProgram,
  listExercises,
  listSessions,
  nextDay,
  saveSession,
  suggestDay,
  TrainingError,
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

const muscles = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "core", "full_body"] as const;
const equipment = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell"] as const;

export const trainingTools = [
  tool(
    "list_exercises",
    "The exercise library: id, Spanish name, primary muscle, secondary muscles, equipment, kind (compound/isolation). Programs and logged sets must use these ids. Filter by muscle (matches primary or secondary), equipment, or a name search.",
    {
      muscle: z.enum(muscles).optional(),
      equipment: z.enum(equipment).optional(),
      query: z.string().optional().describe("Substring of the Spanish name or id, e.g. 'remo'."),
    },
    async (filter) => guard(() => listExercises(filter)),
  ),

  tool(
    "create_program",
    "Write a whole strength program in one call: days in rotation order, each with prescribed exercises (sets, rep range, target RPE or RIR, rest seconds, notes). Exercise ids must come from list_exercises. By default it becomes the active program the phone shows in Entreno (replacing the previous one, whose history is kept). Loads are not prescribed: the app suggests them by double progression from logged sessions. Write names, focus and notes in Spanish.",
    { ...programShape, activate: z.boolean().default(true).describe("Make it the active program.") },
    async ({ activate, ...program }) => guard(() => createProgram(program, activate)),
  ),

  tool(
    "get_active_program",
    "The active program with its days and prescriptions, plus `nextDayId` (the day to train next: pinned to today's weekday, else the one after the last day done) and `suggestions` (next load per program exercise id, kg). `program` is null when none is active.",
    {},
    async () => guard(() => activeProgramView()),
  ),

  tool(
    "list_sessions",
    "Logged strength sessions, newest first, with every set (exerciseId, weightKg, reps, rpe, setIndex). Times are epoch ms. Pass exerciseId to only get sessions that included it.",
    {
      limit: z.number().int().min(1).max(100).default(10),
      exerciseId: z.string().optional(),
    },
    async ({ limit, exerciseId }) => guard(() => listSessions(limit, exerciseId)),
  ),

  tool(
    "exercise_history",
    "One exercise's progress, oldest first: per session the top weight (kg), best Epley e1RM (kg), total reps and volume (kg×reps), plus all-time best e1RM and heaviest load. Use it to judge progress or stalls before changing a program.",
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
    "Next load and target reps (kg) for each exercise of a day of the active program, by double progression: all prescribed sets at the top of the rep range → add one increment; short of the bottom → back off; otherwise same load, one more rep. weightKg is null when the exercise has no history. Defaults to the next day to train.",
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
];
