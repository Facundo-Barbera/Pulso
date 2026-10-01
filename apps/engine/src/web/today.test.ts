import { expect, test } from "bun:test";
import { upsertDailyMetrics } from "../daily/store";
import { addDays, localDate } from "../daily/dates";
import { saveSession } from "../training/store";
import { upsertHealthKitWorkouts } from "../workouts";
import { activityLabel, todayOverview, TREND_DAYS } from "./today";

test("the overview carries one trend entry per day, today's metrics, and recent sessions and workouts merged newest first", () => {
  const now = new Date();
  const today = localDate(now);
  const blank = { steps: null, activeEnergy: null, exerciseMinutes: null, restingHeartRate: null, hrv: null, sleepMinutes: null, sleepDeep: null, sleepCore: null, sleepRem: null, sleepAwake: null, vo2max: null, respiratoryRate: null };
  upsertDailyMetrics([{ ...blank, date: today, steps: 8000 }, { ...blank, date: addDays(today, -3), hrv: 55 }]);
  const t = Date.now();
  upsertHealthKitWorkouts([{ externalId: "today-run", activity: "running", startedAt: t - 3_600_000, endedAt: t - 1_800_000, energy: 300, distance: 5000 }]);
  saveSession({ id: "today-session", name: "Torso A", startedAt: t - 7_200_000, endedAt: t - 3_700_000, sets: [] });

  const overview = todayOverview(now);
  expect(overview.date).toBe(today);
  expect(overview.trend).toHaveLength(TREND_DAYS);
  expect(overview.trend.at(-1)!.date).toBe(today);
  expect(overview.today?.steps).toBe(8000);
  expect(overview.trend.find((d) => d.date === addDays(today, -3))?.metrics?.hrv).toBe(55);
  expect(overview.recent.slice(0, 2).map((r) => r.title)).toEqual(["Carrera", "Torso A"]);
  expect(overview.medication.date).toBe(today);
});

test("unknown HealthKit activities still read as Spanish", () => {
  expect(activityLabel("other_52")).toBe("Entrenamiento");
});
