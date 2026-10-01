import { expect, test } from "bun:test";
import { createProgram, saveSession } from "../training/store";
import { upsertHealthKitWorkouts } from "../workouts";
import { dayKcal, dayMinutes, entrenoOverview, exerciseView, isDeload, prescription, recentRecords, sessionRecords, target, trainingHistory } from "./entreno";

const DAY = 86_400_000;

test("a deload is read from the program's notes like the phone does", () => {
  expect(isDeload(4, 8, "Descarga cada 4 semanas.")).toBe(true);
  expect(isDeload(3, 8, "Descarga cada 4 semanas.")).toBe(false);
  expect(isDeload(6, 6, "Progresión doble. Última semana: descarga")).toBe(true);
  expect(isDeload(6, 8, "Semana 6 de descarga: mitad de series.")).toBe(true);
  expect(isDeload(5, 8, "Semana 6 de descarga: mitad de series.")).toBe(false);
  expect(isDeload(6, 8, null)).toBe(false);
});

test("a day's time, energy and prescriptions follow TrainingPlan.swift", () => {
  const day = { exercises: [{ sets: 4, restSeconds: 120 }, { sets: 3, restSeconds: 90 }] as never[] };
  // 4 × 165 s + 3 × 135 s = 1065 s ≈ 17.75 min → 20
  expect(dayMinutes(day)).toBe(20);
  expect(dayMinutes({ exercises: [] })).toBe(10);
  expect(dayKcal(day, 80)).toBe(133);
  expect(dayKcal(day, null)).toBeNull();
  expect(prescription({ sets: 4, repMin: 6, repMax: 8 }, 32.5)).toBe("4 series × 6–8 reps × 32,5 kg");
  expect(prescription({ sets: 1, repMin: 10, repMax: 10 }, null)).toBe("1 serie × 10 reps");
  expect(prescription({ sets: 3, repMin: 8, repMax: 10 }, 31.75146590, "lb")).toBe("3 series × 8–10 reps × 70 lb");
  expect(target({ sets: 3, repMin: 6, repMax: 8, targetRir: 2, targetRpe: null })).toBe("3 × 6–8 · RIR 2");
  expect(target({ sets: 3, repMin: 8, repMax: 8, targetRir: null, targetRpe: 7.5 })).toBe("3 × 8 · RPE 7,5");
});

test("a record beats every earlier session; a first time is not one", () => {
  const now = Date.now();
  const s = (id: string, daysAgo: number, weightKg: number) => ({ id, startedAt: now - daysAgo * DAY, sets: [{ exerciseId: "press-banca", setIndex: 0, weightKg, reps: 5, rpe: null, doneAt: 0 }] });
  const sessions = [s("a", 40, 80), s("b", 30, 85), s("c", 3, 82.5), s("d", 2, 90)];
  const bySession = sessionRecords(sessions);
  expect([...bySession.get("a")!]).toEqual([]);
  expect([...bySession.get("b")!]).toEqual(["press-banca"]);
  expect([...bySession.get("c")!]).toEqual([]);
  expect([...bySession.get("d")!]).toEqual(["press-banca"]);
  expect(recentRecords(sessions.slice(0, 3), now).size).toBe(0);
  expect(recentRecords(sessions, now)).toEqual(new Set(["press-banca"]));
});

test("the overview carries the active program's days with media, muscles and suggestions, and a merged history", () => {
  const now = new Date();
  const t = now.getTime();
  const program = createProgram({
    name: "Torso / Pierna",
    goal: "Fuerza",
    weeks: 8,
    notes: "Descarga cada 4 semanas.",
    days: [
      { name: "Torso A", focus: "Empuje", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 6, repMax: 8, targetRir: 2, restSeconds: 120 }] },
      { name: "Pierna A", exercises: [{ exerciseId: "sentadilla", sets: 4, repMin: 5, repMax: 5, restSeconds: 180 }] },
    ],
  });
  const day1 = program.days[0]!;
  saveSession({ id: "web-entreno-1", programId: program.id, dayId: day1.id, name: "Torso A", startedAt: t - 3 * DAY, endedAt: t - 3 * DAY + 3_600_000, sets: [{ exerciseId: "press-banca", setIndex: 0, weightKg: 80, reps: 8, rpe: 8, doneAt: t - 3 * DAY }] });
  upsertHealthKitWorkouts([{ externalId: "web-entreno-run", activity: "running", startedAt: t - DAY, endedAt: t - DAY + 1_800_000, energy: 320, distance: 5200, sourceName: "Apple Watch" }]);

  const view = entrenoOverview(now);
  expect(view.program).toMatchObject({ id: program.id, name: "Torso / Pierna", week: 1, weeks: 8, deload: false });
  expect(view.days.map((d) => `${d.number} ${d.name}`)).toEqual(["1 Torso A", "2 Pierna A"]);
  // The last session was day 1, so day 2 is next (no weekday pins).
  expect(view.nextDayId).toBe(program.days[1]!.id);
  expect(view.days[1]!.tagline).toBe("Siguiente");
  const bench = view.days[0]!.exercises[0]!;
  expect(bench.primaryMuscles).toContain("chest");
  expect(bench.suggestion?.weightKg).toBeGreaterThan(0);
  expect(bench.prescription).toMatch(/^3 series × 6–8 reps × /);
  expect(bench.target).toBe("3 × 6–8 · RIR 2");

  const run = view.history.find((h) => h.kind === "workout" && h.title === "Carrera")!;
  expect(run).toMatchObject({ summary: "320 kcal · 5,2 km", source: "Apple Watch", distanceKm: 5.2 });
  const lifted = view.history.find((h) => h.id === "web-entreno-1")!;
  expect(lifted.exercises).toEqual([{ exerciseId: "press-banca", name: "Press de banca", record: false, unit: "kg", sets: [{ weightKg: 80, reps: 8, rpe: 8 }] }]);
  expect(view.history.indexOf(run)).toBeLessThan(view.history.indexOf(lifted));
  expect(trainingHistory(1)).toHaveLength(1);
});

test("the exercise view points its media at the web app's route", () => {
  const view = exerciseView("press-banca")!;
  expect(view.detail.name).toBe("Press de banca");
  for (const url of [view.detail.media.animation, view.detail.media.thumbnail]) if (url) expect(url.startsWith("/api/web/entreno/media/")).toBe(true);
  expect(exerciseView("no-such-exercise")).toBeUndefined();
});
