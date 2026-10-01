import { z } from "zod";

export const equipmentEnum = z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band"]);
export const weightUnitEnum = z.enum(["kg", "lb"]);

export const cardioTargetShape = z.object({
  durationMinutes: z.number().min(1).max(240).nullish().describe("Minutes, the usual target."),
  distanceKm: z.number().min(0.1).max(100).nullish(),
  speedKmh: z.number().min(1).max(40).nullish().describe("Treadmill or bike speed, km/h."),
  paceMinPerKm: z.number().min(2).max(20).nullish().describe("Running pace, minutes per km (5.5 = 5:30/km)."),
  inclinePercent: z.number().min(0).max(30).nullish().describe("Treadmill incline, %."),
  level: z.number().min(1).max(30).nullish().describe("Machine resistance or level."),
  zone: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullish().describe("Heart-rate zone: 1 recovery, 2 aerobic base, 3 tempo, 4 threshold, 5 max."),
  intervals: z
    .object({
      rounds: z.number().int().min(1).max(50),
      workSeconds: z.number().int().min(5).max(1800),
      restSeconds: z.number().int().min(0).max(1800),
      workLabel: z.string().max(30).nullish().describe('Spanish cue, e.g. "Rápido".'),
      restLabel: z.string().max(30).nullish().describe('Spanish cue, e.g. "Suave".'),
    })
    .nullish()
    .describe("Work/recovery repeats, e.g. 8 × 30 s / 90 s."),
});

/** A superset label; the engine clears it when the members aren't 2+ consecutive strength exercises. */
export const supersetIdShape = z.string().max(32).nullish();

/** One prescribed exercise or cardio block. Shared by the program tools and their tests. */
export const programExerciseShape = z.object({
  exerciseId: z.string().describe("Exercise id from list_exercises, e.g. `press-banca` or `eliptica`."),
  sets: z.number().int().min(1).max(10).optional().describe("Working sets (strength; omit for cardio)."),
  repMin: z.number().int().min(1).max(50).optional().describe("Bottom of the rep range (strength)."),
  repMax: z.number().int().min(1).max(50).optional().describe("Top of the rep range; reaching it on every set triggers a load increase (strength)."),
  targetRpe: z.number().min(5).max(10).nullish().describe("Target RPE 5–10 (10 = failure)."),
  targetRir: z.number().int().min(0).max(5).nullish().describe("Target reps in reserve."),
  restSeconds: z.number().int().min(0).max(600).optional().describe("Rest after each set, seconds (strength)."),
  notes: z.string().max(300).nullish().describe("Cue or technique note shown to the person, in Spanish."),
  cardio: cardioTargetShape.nullish().describe("Required for cardio exercises (kind cardio): duration, zone, intervals…"),
  weightKg: z.number().min(0).max(1000).nullish().describe("A load the person chose for next time, kg; omit to let progression suggest it."),
  supersetId: supersetIdShape.describe(
    'Superset label, e.g. "a": give it to 2+ consecutive strength exercises to do them as a superset (alternating, rest after the last). Null or omitted = a plain exercise.',
  ),
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

/**
 * An optional reading (RPE, heart rate, distance…): one out of range or not a
 * number is dropped rather than refusing the whole workout it came with.
 */
const reading = (min: number, max: number) =>
  z
    .number()
    .nullish()
    .transform((v) => (v != null && Number.isFinite(v) && v >= min && v <= max ? v : null));

const cardioLog = z.object({
  exerciseId: z.string(),
  durationSeconds: z.number().min(0).max(86_400),
  distanceKm: reading(0, 500),
  level: reading(0, 100),
  inclinePercent: reading(0, 50),
  avgHr: reading(20, 250),
  kcal: reading(0, 10_000),
  doneAt: z.number().finite(),
});

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
        rpe: reading(1, 10),
        doneAt: z.number().finite(),
      }),
    )
    .max(300),
  cardio: z.array(cardioLog).max(20).optional(),
});

const liveSet = z.object({
  id: z.string().min(1).max(64),
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(200),
  rpe: reading(1, 10),
  doneAt: z.number().finite().nullable(),
});


/** The phone's copy of the session in progress (`LiveSession`). */
export const liveSessionInput = z.object({
  session: z.object({
    id: z.string().min(1).max(64),
    programId: z.string().nullish().transform((v) => v ?? null),
    dayId: z.string().nullish().transform((v) => v ?? null),
    name: z.string().min(1).max(80),
    startedAt: z.number().finite(),
    exercises: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          exerciseId: z.string(),
          name: z.string().max(120),
          equipment: equipmentEnum,
          kind: z.enum(["compound", "isolation", "cardio"]),
          modality: z.string().nullish().transform((v) => (v ?? null) as never),
          repMin: z.number().int().min(0).max(100),
          repMax: z.number().int().min(0).max(100),
          targetRpe: z.number().nullish().transform((v) => v ?? null),
          targetRir: z.number().nullish().transform((v) => v ?? null),
          restSeconds: z.number().int().min(0).max(3600),
          notes: z.string().max(1000).nullish().transform((v) => v ?? null),
          hint: z.string().max(1000).nullish().transform((v) => v ?? null),
          sets: z.array(liveSet).max(30),
          cardio: cardioTargetShape.nullish().transform((v) => v ?? null),
          cardioLog: cardioLog.nullish().transform((v) => v ?? null),
          skipped: z.boolean().default(false),
          cutShort: z
            .object({ at: z.number().finite(), reason: z.string().max(200).nullish().transform((v) => v ?? null) })
            .nullish()
            .transform((v) => v ?? null),
          supersetId: supersetIdShape.transform((v) => v ?? null),
        }),
      )
      .max(40),
    focus: z.number().int().min(0).default(0),
    restStartedAt: z.number().finite().nullish().transform((v) => v ?? null),
    restEndsAt: z.number().finite().nullish().transform((v) => v ?? null),
    cardioClock: z
      .object({ exerciseId: z.string().min(1).max(64), runningSince: z.number().finite().nullable(), accumulatedSeconds: z.number().finite().min(0) })
      .nullish()
      .transform((v) => v ?? null),
    version: z.number().int().min(0).default(0),
    updatedAt: z.number().finite().default(0),
    threadId: z.string().nullish().transform((v) => v ?? null),
  }),
  baseVersion: z.number().int().min(0),
});
