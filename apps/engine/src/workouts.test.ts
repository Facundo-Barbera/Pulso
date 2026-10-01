import { expect, test } from "bun:test";
import { listWorkouts, parseWorkoutInputs, upsertHealthKitWorkouts } from "./workouts";

const run = { externalId: "hk-1", activity: "running", startedAt: 1_000, endedAt: 1_800_000, energy: 300, distance: 5000 };

test("re-syncing the same HealthKit workout updates instead of duplicating", () => {
  upsertHealthKitWorkouts([run]);
  upsertHealthKitWorkouts([{ ...run, energy: 320 }]);
  const stored = listWorkouts().filter((w) => w.externalId === "hk-1");
  expect(stored).toHaveLength(1);
  expect(stored[0]?.energy).toBe(320);
  expect(stored[0]?.source).toBe("healthkit");
});

test("parseWorkoutInputs rejects malformed bodies", () => {
  expect(parseWorkoutInputs({ workouts: [run] })).toHaveLength(1);
  expect(parseWorkoutInputs({ workouts: [{ ...run, energy: undefined, distance: null }] })?.[0]?.energy).toBeNull();
  expect(parseWorkoutInputs({ workouts: [{ ...run, startedAt: "yesterday" }] })).toBeUndefined();
  expect(parseWorkoutInputs({})).toBeUndefined();
  expect(parseWorkoutInputs(undefined)).toBeUndefined();
});
