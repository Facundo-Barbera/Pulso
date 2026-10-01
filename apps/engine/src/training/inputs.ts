import { z } from "zod";

/** One prescribed exercise. Shared by the create_program tool and its tests. */
export const programExerciseShape = z.object({
  exerciseId: z.string().describe("Exercise id from list_exercises, e.g. `press-banca`."),
  sets: z.number().int().min(1).max(10).describe("Working sets."),
  repMin: z.number().int().min(1).max(50).describe("Bottom of the rep range."),
  repMax: z.number().int().min(1).max(50).describe("Top of the rep range; reaching it on every set triggers a load increase."),
  targetRpe: z.number().min(5).max(10).nullish().describe("Target RPE 5–10 (10 = failure)."),
  targetRir: z.number().int().min(0).max(5).nullish().describe("Target reps in reserve."),
  restSeconds: z.number().int().min(15).max(600).describe("Rest after each set, seconds."),
  notes: z.string().max(300).nullish().describe("Cue or technique note shown to the person, in Spanish."),
});

export const programDayShape = z.object({
  name: z.string().min(1).max(60).describe('Day name in Spanish, e.g. "Torso A".'),
  focus: z.string().max(120).nullish().describe('Short focus line in Spanish, e.g. "Empuje pesado".'),
  weekday: z.number().int().min(1).max(7).nullish().describe("Pin to an ISO weekday (1 = Monday … 7 = Sunday); omit to rotate days in order."),
  exercises: z.array(programExerciseShape).min(1).max(15),
});

export const programShape = {
  name: z.string().min(1).max(80).describe("Program name in Spanish."),
  goal: z.string().min(1).max(300).describe("What the program is for, in Spanish."),
  weeks: z.number().int().min(1).max(52).describe("Planned length in weeks."),
  notes: z.string().max(1000).nullish().describe("Progression rules, deload plan, anything the person should know."),
  days: z.array(programDayShape).min(1).max(7).describe("Training days in rotation order."),
};

/** A finished session as the phone posts it. Times epoch ms, weight kg. */
export const sessionInput = z.object({
  id: z.string().min(1).max(64),
  programId: z.string().nullish(),
  dayId: z.string().nullish(),
  name: z.string().min(1).max(80),
  startedAt: z.number().finite(),
  endedAt: z.number().finite(),
  notes: z.string().max(1000).nullish(),
  sets: z
    .array(
      z.object({
        exerciseId: z.string(),
        setIndex: z.number().int().min(0),
        weightKg: z.number().min(0).max(1000),
        reps: z.number().int().min(0).max(200),
        rpe: z.number().min(1).max(10).nullish().transform((v) => v ?? null),
        doneAt: z.number().finite(),
      }),
    )
    .max(300),
});
