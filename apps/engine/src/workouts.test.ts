import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { WorkoutInput } from "@pulso/contract";
import { db } from "./db";
import { listWorkouts, parseWorkoutInputs, upsertHealthKitWorkouts } from "./workouts";
import { findDuplicates } from "./workouts-dedupe";
import { migrateWorkouts } from "./workouts-schema";

const MIN = 60_000;
const at = (hour: number, minute: number) => Date.UTC(2026, 8, 30, hour, minute);
const run = { externalId: "hk-1", activity: "running", startedAt: 1_000, endedAt: 1_800_000, energy: 300, distance: 5000 };
const lift = (externalId: string, start: Date | number, minutes: number, extra: Partial<WorkoutInput> = {}): WorkoutInput => ({
  externalId,
  activity: "strength",
  startedAt: +start,
  endedAt: +start + minutes * MIN,
  energy: null,
  distance: null,
  ...extra,
});

beforeEach(() => db().exec("DELETE FROM workouts"));

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
  expect(parseWorkoutInputs({ workouts: [{ ...run, sourceName: 3 }] })).toBeUndefined();
  expect(parseWorkoutInputs({})).toBeUndefined();
  expect(parseWorkoutInputs(undefined)).toBeUndefined();
});

test("the source is stored, and an older client without one keeps it", () => {
  upsertHealthKitWorkouts([{ ...run, sourceBundle: "com.apple.health.abc", sourceName: "Apple Watch" }]);
  upsertHealthKitWorkouts([run]);
  expect(listWorkouts()[0]).toMatchObject({ sourceBundle: "com.apple.health.abc", sourceName: "Apple Watch" });
  expect(parseWorkoutInputs({ workouts: [run] })?.[0]).toMatchObject({ sourceBundle: null, sourceName: null });
});

describe("duplicates", () => {
  test("the 13:05 / 13:06 strength session recorded by two apps is one workout, keeping the richer one", () => {
    upsertHealthKitWorkouts([
      lift("watch", at(13, 5), 62, { energy: 410, sourceName: "Apple Watch" }),
      lift("gym", at(13, 6), 61, { sourceName: "Gym app" }),
    ]);
    const workouts = listWorkouts();
    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({ externalId: "watch", energy: 410, sourceName: "Apple Watch" });
    // Linked, not deleted.
    const stored = db().query<{ external_id: string; duplicate_of: string | null }, []>("SELECT external_id, duplicate_of FROM workouts").all();
    expect(stored).toHaveLength(2);
    expect(stored.find((r) => r.external_id === "gym")?.duplicate_of).toBe(workouts[0]!.id);
  });

  test("the outcome does not depend on which copy arrives first, nor on later syncs", () => {
    upsertHealthKitWorkouts([lift("gym", at(13, 6), 61)]);
    expect(listWorkouts().map((w) => w.externalId)).toEqual(["gym"]);
    upsertHealthKitWorkouts([lift("watch", at(13, 5), 62, { energy: 410 })]);
    expect(listWorkouts().map((w) => w.externalId)).toEqual(["watch"]);
    upsertHealthKitWorkouts([lift("watch", at(13, 5), 62, { energy: 410 }), lift("gym", at(13, 6), 61)]);
    expect(listWorkouts().map((w) => w.externalId)).toEqual(["watch"]);
  });

  test("five sessions each recorded twice read as five", () => {
    const inputs = [10, 11, 12, 13, 14].flatMap((h) => [lift(`a${h}`, at(h, 5), 60, { energy: 300 }), lift(`b${h}`, at(h, 6), 60)]);
    upsertHealthKitWorkouts(inputs);
    expect(listWorkouts()).toHaveLength(5);
    expect(listWorkouts(3)).toHaveLength(3);
  });

  test("partial overlaps: merged above half of the shorter one, kept apart at or below", () => {
    upsertHealthKitWorkouts([lift("long", at(9, 0), 60, { energy: 200 }), lift("inside", at(9, 20), 20)]); // 100 % of the shorter
    expect(listWorkouts()).toHaveLength(1);
    db().exec("DELETE FROM workouts");
    upsertHealthKitWorkouts([lift("a", at(9, 0), 60, { energy: 200 }), lift("b", at(9, 25), 60)]); // 35/60 = 58 %
    expect(listWorkouts()).toHaveLength(1);
    db().exec("DELETE FROM workouts");
    upsertHealthKitWorkouts([lift("a", at(9, 0), 60, { energy: 200 }), lift("b", at(9, 30), 60)]); // exactly 50 %
    expect(listWorkouts()).toHaveLength(2);
    db().exec("DELETE FROM workouts");
    upsertHealthKitWorkouts([lift("a", at(9, 0), 60), lift("b", at(10, 0), 60)]); // back to back
    expect(listWorkouts()).toHaveLength(2);
  });

  test("different activities at the same time are never merged", () => {
    upsertHealthKitWorkouts([lift("lift", at(18, 0), 45), { ...lift("walk", at(18, 0), 45), activity: "walking" }]);
    expect(listWorkouts()).toHaveLength(2);
  });

  test("more distance or energy wins, then the longer recording", () => {
    const rows = [
      { id: "plain", activity: "x", started_at: 0, ended_at: 60 * MIN, energy: null, distance: null },
      { id: "short", activity: "x", started_at: 0, ended_at: 50 * MIN, energy: null, distance: null },
      { id: "rich", activity: "x", started_at: 5 * MIN, ended_at: 55 * MIN, energy: 100, distance: 1000 },
    ];
    expect(Object.fromEntries(findDuplicates(rows))).toEqual({ plain: "rich", short: "rich" });
    expect(Object.fromEntries(findDuplicates(rows.slice(0, 2)))).toEqual({ short: "plain" });
  });
});

describe("migration", () => {
  const oldSchema = `
    CREATE TABLE workouts (
      id TEXT PRIMARY KEY, external_id TEXT UNIQUE, source TEXT NOT NULL, activity TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, energy REAL, distance REAL
    );
    CREATE INDEX workouts_started ON workouts (started_at DESC);`;
  const insert = "INSERT INTO workouts VALUES (?, ?, 'healthkit', 'strength', ?, ?, ?, NULL)";

  test("adds the columns to an existing database, links its duplicates and can run again", () => {
    const old = new Database(":memory:", { strict: true });
    old.exec(oldSchema);
    old.query(insert).run("w1", "hk-1", at(13, 5), at(14, 7), 410);
    old.query(insert).run("w2", "hk-2", at(13, 6), at(14, 7), null);
    old.query(insert).run("w3", "hk-3", at(16, 0), at(16, 30), null);

    migrateWorkouts(old);
    migrateWorkouts(old);

    const columns = old.query<{ name: string }, []>("PRAGMA table_info(workouts)").all().map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["source_bundle", "source_name", "duplicate_of"]));
    expect(columns.filter((c) => c === "duplicate_of")).toHaveLength(1);
    const links = Object.fromEntries(old.query<{ id: string; duplicate_of: string | null }, []>("SELECT id, duplicate_of FROM workouts").all().map((r) => [r.id, r.duplicate_of]));
    expect(links).toEqual({ w1: null, w2: "w1", w3: null });
  });

  test("a fresh database has the same columns", () => {
    const fresh = new Database(":memory:", { strict: true });
    fresh.exec("CREATE TABLE workouts (id TEXT PRIMARY KEY, external_id TEXT UNIQUE, source TEXT NOT NULL, activity TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, energy REAL, distance REAL)");
    migrateWorkouts(fresh);
    expect(fresh.query<{ name: string }, []>("PRAGMA table_info(workouts)").all().map((c) => c.name)).toContain("duplicate_of");
  });
});
