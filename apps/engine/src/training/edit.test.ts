import { expect, test } from "bun:test";
import type { DayExerciseInput, ProgramExercise } from "@pulso/contract";
import { updateProfile } from "../agent/profile";
import { parseDailyInputs, upsertDailyMetrics } from "../daily/store";
import { localDate } from "../daily/dates";
import { db } from "../db";
import {
  activeProgramView,
  clearDayOverride,
  createProgram,
  getActiveProgram,
  hrZones,
  listSessions,
  saveSession,
  TrainingError,
  updateProgramDay,
} from "./store";

const NOW = new Date(2026, 9, 1, 10).getTime();

const fresh = () =>
  createProgram(
    {
      name: "Torso / Pierna + cardio",
      goal: "Hipertrofia y base aeróbica",
      weeks: 6,
      days: [
        {
          name: "Torso A",
          exercises: [
            { exerciseId: "press-banca", sets: 3, repMin: 6, repMax: 8, restSeconds: 150 },
            { exerciseId: "remo-barra", sets: 3, repMin: 8, repMax: 10, restSeconds: 120 },
            { exerciseId: "elevaciones-laterales", sets: 3, repMin: 12, repMax: 15, restSeconds: 60 },
            { exerciseId: "eliptica", cardio: { durationMinutes: 20, zone: 2 } },
          ],
        },
        { name: "Cardio", exercises: [{ exerciseId: "bici-estatica", cardio: { intervals: { rounds: 8, workSeconds: 30, restSeconds: 90, workLabel: "Rápido", restLabel: "Suave" }, zone: 4 } }] },
      ],
    },
    true,
    NOW - 86_400_000,
  );

const keep = (e: ProgramExercise): DayExerciseInput => ({ ...e });

test("cardio blocks sit in a day with their target, no load suggestion, and a modality", () => {
  const program = fresh();
  const [torso, cardio] = program.days;
  const block = torso!.exercises[3]!;
  expect(block).toMatchObject({ exerciseId: "eliptica", kind: "cardio", modality: "elliptical", sets: 1, restSeconds: 0, cardio: { durationMinutes: 20, zone: 2 } });
  expect(cardio!.exercises[0]!.cardio?.intervals).toEqual({ rounds: 8, workSeconds: 30, restSeconds: 90, workLabel: "Rápido", restLabel: "Suave" });
  const view = activeProgramView(NOW);
  expect(Object.keys(view.suggestions)).not.toContain(block.id);
  expect(Object.keys(view.suggestions)).toContain(torso!.exercises[0]!.id);
});

test("strength exercises without sets/reps/rest are refused; a cardio block without a target gets 20 min in zone 2", () => {
  const program = fresh();
  const dayId = program.days[0]!.id;
  expect(() => updateProgramDay(dayId, { scope: "always", exercises: [{ exerciseId: "press-banca" }] }, NOW)).toThrow(TrainingError);
  expect(() => updateProgramDay(dayId, { scope: "always", exercises: [{ exerciseId: "nope", sets: 3, repMin: 5, repMax: 8, restSeconds: 60 }] }, NOW)).toThrow(/Unknown exercise/);
  expect(() => updateProgramDay(dayId, { scope: "always", exercises: [] }, NOW)).toThrow(/no exercises/);
  expect(() => updateProgramDay("nope", { scope: "always", exercises: [{ exerciseId: "caminar" }] }, NOW)).toThrow(/Unknown program day/);
  const view = updateProgramDay(dayId, { scope: "always", exercises: [{ exerciseId: "caminar" }] }, NOW);
  expect(view.program!.days[0]!.exercises[0]!.cardio).toEqual({ durationMinutes: 20, zone: 2 });
});

test("para siempre: reorder, edit, swap, add and remove in one write, keeping ids so suggestions follow", () => {
  const program = fresh();
  const day = program.days[0]!;
  const [bench, row, lateral] = day.exercises;
  const view = updateProgramDay(
    day.id,
    {
      scope: "always",
      exercises: [
        { ...keep(row!), sets: 4 },
        { ...keep(bench!), exerciseId: "press-pecho-maquina" },
        { exerciseId: "curl-maquina", sets: 2, repMin: 10, repMax: 12, restSeconds: 60 },
      ],
    },
    NOW,
  );
  const edited = view.program!.days.find((d) => d.id === day.id)!;
  expect(edited.overridden).toBeUndefined();
  expect(edited.exercises.map((e) => e.exerciseId)).toEqual(["remo-barra", "press-pecho-maquina", "curl-maquina"]);
  expect(edited.exercises[0]).toMatchObject({ id: row!.id, sets: 4 });
  expect(edited.exercises[1]).toMatchObject({ id: bench!.id, exerciseName: "Press de pecho en máquina", equipment: "machine" });
  expect(edited.exercises.map((e) => e.id)).not.toContain(lateral!.id);
  expect(view.suggestions[bench!.id]?.exerciseId).toBe("press-pecho-maquina");
  expect(getActiveProgram()!.days[0]!.exercises.length).toBe(3);
});

test("solo hoy: today's list overrides the day, the program stays, and it can be reset", () => {
  const program = fresh();
  const day = program.days[0]!;
  const view = updateProgramDay(day.id, { scope: "today", exercises: [{ ...keep(day.exercises[1]!) }, { exerciseId: "remo-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 90 }] }, NOW);
  const today = view.program!.days[0]!;
  expect(today.overridden).toBe(true);
  expect(today.exercises.map((e) => e.exerciseId)).toEqual(["remo-barra", "remo-maquina"]);
  expect(today.exercises[0]!.id).toBe(day.exercises[1]!.id);
  expect(view.suggestions[today.exercises[1]!.id]).toBeDefined();
  // The program itself is untouched, and tomorrow the override no longer applies.
  expect(getActiveProgram()!.days[0]!.exercises.length).toBe(4);
  expect(activeProgramView(NOW + 86_400_000).program!.days[0]!.overridden).toBeUndefined();

  expect(clearDayOverride(day.id, NOW).program!.days[0]!.exercises.length).toBe(4);
});

test("para siempre drops today's override of that day", () => {
  const program = fresh();
  const day = program.days[0]!;
  updateProgramDay(day.id, { scope: "today", exercises: [{ ...keep(day.exercises[0]!) }] }, NOW);
  const view = updateProgramDay(day.id, { scope: "always", exercises: day.exercises.slice(0, 2).map(keep) }, NOW);
  expect(view.program!.days[0]!.overridden).toBeUndefined();
  expect(view.program!.days[0]!.exercises.length).toBe(2);
});

test("a hand-set load is the suggestion until the exercise is logged again", () => {
  const program = fresh();
  const day = program.days[0]!;
  const bench = day.exercises[0]!;
  const view = updateProgramDay(day.id, { scope: "always", exercises: [{ ...keep(bench), weightKg: 62.5 }, ...day.exercises.slice(1).map(keep)] }, NOW);
  expect(view.program!.days[0]!.exercises[0]!.weightKg).toBe(62.5);
  expect(view.suggestions[bench.id]).toMatchObject({ weightKg: 62.5, reps: 6 });

  saveSession({
    id: `hand-set-${NOW}`,
    name: "Torso A",
    startedAt: NOW + 60_000,
    endedAt: NOW + 3_600_000,
    sets: [0, 1, 2].map((i) => ({ exerciseId: "press-banca", setIndex: i, weightKg: 62.5, reps: 8, rpe: null, doneAt: NOW + 120_000 + i })),
  });
  const after = activeProgramView(NOW);
  expect(after.program!.days[0]!.exercises[0]!.weightKg).toBeNull();
  expect(after.suggestions[bench.id]!.weightKg).toBe(65);
});

const supersets = (exercises: ProgramExercise[]) => exercises.map((e) => e.supersetId);

test("supersets: saved normalized, kept para siempre and solo hoy, cleared when split", () => {
  const program = fresh();
  const day = program.days[0]!;
  expect(supersets(day.exercises)).toEqual([null, null, null, null]);
  const [bench, row, lateral, elliptical] = day.exercises.map(keep);

  // Bench + row paired; a lone label and a cardio block in a superset are cleared.
  let view = updateProgramDay(day.id, { scope: "always", exercises: [{ ...bench!, supersetId: "a" }, { ...row!, supersetId: "a" }, { ...lateral!, supersetId: "b" }, { ...elliptical!, supersetId: "b" }] }, NOW);
  expect(supersets(view.program!.days[0]!.exercises)).toEqual(["a", "a", null, null]);
  expect(supersets(getActiveProgram()!.days[0]!.exercises)).toEqual(["a", "a", null, null]);

  // Solo hoy carries it in the override; the program keeps its own.
  const kept = view.program!.days[0]!.exercises.map(keep);
  view = updateProgramDay(day.id, { scope: "today", exercises: [kept[0]!, kept[1]!, { ...kept[2]!, supersetId: "c" }, { exerciseId: "curl-maquina", sets: 2, repMin: 10, repMax: 12, restSeconds: 60, supersetId: "c" }] }, NOW);
  expect(view.program!.days[0]!.overridden).toBe(true);
  expect(supersets(view.program!.days[0]!.exercises)).toEqual(["a", "a", "c", "c"]);
  expect(supersets(getActiveProgram()!.days[0]!.exercises)).toEqual(["a", "a", null, null]);
  clearDayOverride(day.id, NOW);

  // Reordering so the pair is no longer adjacent clears both.
  view = updateProgramDay(day.id, { scope: "always", exercises: [kept[0]!, kept[2]!, kept[1]!] }, NOW);
  expect(view.program!.days[0]!.exercises.map((e) => [e.exerciseId, e.supersetId])).toEqual([
    ["press-banca", null],
    ["elevaciones-laterales", null],
    ["remo-barra", null],
  ]);
});

test("supersets: createProgram normalizes, and overrides saved before supersets read as null", () => {
  const program = createProgram(
    {
      name: "Superseries",
      goal: "x",
      weeks: 4,
      days: [
        {
          name: "Brazos",
          exercises: [
            { exerciseId: "curl-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 60, supersetId: "a" },
            { exerciseId: "press-pecho-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 60, supersetId: "a" },
            { exerciseId: "remo-barra", sets: 3, repMin: 8, repMax: 10, restSeconds: 90, supersetId: "a" },
            { exerciseId: "elevaciones-laterales", sets: 3, repMin: 12, repMax: 15, restSeconds: 60 },
            { exerciseId: "remo-maquina", sets: 3, repMin: 10, repMax: 12, restSeconds: 60, supersetId: "a" },
          ],
        },
      ],
    },
    true,
    NOW,
  );
  expect(supersets(program.days[0]!.exercises)).toEqual(["a", "a", "a", null, null]);

  const old = program.days[0]!.exercises.map(({ supersetId: _, ...rest }) => rest);
  db().run("INSERT INTO program_day_overrides (day_id, date, exercises, updated_at) VALUES (?, ?, ?, ?)", [program.days[0]!.id, localDate(new Date(NOW)), JSON.stringify(old), NOW]);
  const today = activeProgramView(NOW).program!.days[0]!;
  expect(today.overridden).toBe(true);
  expect(supersets(today.exercises)).toEqual([null, null, null, null, null]);
  clearDayOverride(program.days[0]!.id, NOW);
});

test("sessions keep cardio blocks and add up their minutes", () => {
  const start = NOW - 7_200_000;
  const saved = saveSession({
    id: "cardio-session",
    name: "Cardio",
    startedAt: start,
    endedAt: start + 3_000_000,
    sets: [],
    cardio: [
      { exerciseId: "bici-estatica", durationSeconds: 1200, distanceKm: 9.5, level: 8, inclinePercent: null, avgHr: 142, kcal: 210, doneAt: start + 1_300_000 },
      { exerciseId: "caminadora", durationSeconds: 630, distanceKm: null, level: null, inclinePercent: 8, avgHr: null, kcal: null, doneAt: start + 2_000_000 },
    ],
  });
  expect(saved.session.cardio.map((c) => c.exerciseId)).toEqual(["bici-estatica", "caminadora"]);
  expect(saved.session.cardioMinutes).toBe(30.5);
  expect(listSessions(5, "caminadora").map((s) => s.id)).toContain("cardio-session");
  expect(() => saveSession({ id: "bad", name: "x", startedAt: 1, endedAt: 2, sets: [], cardio: [{ exerciseId: "nope", durationSeconds: 1, distanceKm: null, level: null, inclinePercent: null, avgHr: null, kcal: null, doneAt: 1 }] })).toThrow(TrainingError);
});

test("heart-rate zones: none without an age, % of max from age, Karvonen with a recent resting HR", () => {
  updateProfile({ age: null });
  expect(hrZones(NOW)).toBeNull();
  updateProfile({ age: 40 });
  // Tanaka: 208 − 0.7 × 40 = 180.
  expect(hrZones(NOW)![1]).toEqual({ zone: 2, minBpm: 108, maxBpm: 126 });
  upsertDailyMetrics([parseDailyInputs({ days: [{ date: localDate(new Date(NOW)), restingHeartRate: 60 }] })![0]!]);
  // 60 + 0.6 × 120 = 132 … 60 + 0.7 × 120 = 144.
  expect(hrZones(NOW)![1]).toEqual({ zone: 2, minBpm: 132, maxBpm: 144 });
  expect(hrZones(NOW)![4]!.maxBpm).toBe(180);
  expect(activeProgramView(NOW).hrZones?.length).toBe(5);
  updateProfile({ age: null });
});
