import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { CardioLog, Workout, WorkoutInput } from "@pulso/contract";
import { db } from "./db";
import { saveSession } from "./training/store";
import { parseWorkoutInputs, upsertHealthKitWorkouts } from "./workouts";
import {
  attach,
  fillCardio,
  isPulsoWritten,
  linkWorkout,
  listMergedSessions,
  mergedSessionDetail,
  part,
  recentActivity,
  recording,
  standaloneWorkouts,
  unlinkWorkout,
} from "./workouts-merge";

const MIN = 60_000;
// A past day no other test file uses: they share this database, and a newer session would be everyone's "last".
const at = (hour: number, minute: number) => Date.UTC(2019, 4, 14, hour, minute);

const workout = (id: string, activity: string, start: number, minutes: number, extra: Partial<Workout> = {}): Workout => ({
  id,
  externalId: id,
  source: "healthkit",
  activity,
  startedAt: start,
  endedAt: start + minutes * MIN,
  energy: null,
  distance: null,
  sourceBundle: "com.apple.health.watch",
  sourceName: "Apple Watch",
  ...extra,
});

// 1 Oct: "Torso A" in Pulso 13:20–14:01; the Watch's "Fuerza" (19 min, 134 kcal) and "Caminata" (9 min, 67 kcal, 0,49 km, the treadmill block).
const torso = { id: "merge-torso", startedAt: at(13, 20), endedAt: at(14, 1) };
const fuerza = workout("fuerza", "strength", at(13, 22), 19, { energy: 134, avgHeartRate: 118, maxHeartRate: 151 });
const caminata = workout("caminata", "walking", at(13, 45), 9, { energy: 67, distance: 490, avgHeartRate: 104, maxHeartRate: 122 });

describe("matching by time", () => {
  test("the Watch's strength workout and its treadmill walk are both part of the session", () => {
    const { bySession, sessionOf, hidden } = attach([torso], [fuerza, caminata], new Map());
    expect(bySession.get(torso.id)?.map((a) => [a.workout.id, a.link])).toEqual([["fuerza", "overlap"], ["caminata", "overlap"]]);
    expect(sessionOf.get("caminata")).toBe(torso.id);
    expect(hidden.size).toBe(0);
  });

  test("10 minutes of slack either side, as long as half the workout is inside it", () => {
    const early = workout("early", "walking", at(13, 12), 8); // starts 8 min before: wholly in the slack
    const after = workout("after", "walking", at(14, 6), 4); // ends 9 min after the session
    const run = workout("run", "running", at(12, 25), 60); // ends 5 min before, but 15 of its 60 min are in the window
    const late = workout("late", "walking", at(14, 9), 10); // 2 of 10 min in the window
    const { sessionOf } = attach([torso], [early, after, run, late], new Map());
    expect(sessionOf.get("early")).toBe(torso.id);
    expect(sessionOf.get("after")).toBe(torso.id);
    expect(sessionOf.has("run")).toBe(false);
    expect(sessionOf.has("late")).toBe(false);
  });

  test("a workout between two sessions goes to the one it overlaps most", () => {
    const second = { id: "second", startedAt: at(14, 20), endedAt: at(15, 0) };
    const bridge = workout("bridge", "strength", at(14, 0), 30); // 11 min in Torso A's window, 20 in the second's
    expect(attach([torso, second], [bridge], new Map()).sessionOf.get("bridge")).toBe("second");
  });
});

describe("Pulso's own copies in Salud", () => {
  test("recognised by bundle id or by the session id in their metadata, never shown or counted", () => {
    const own = workout("own", "strength", torso.startedAt, 41, { sourceBundle: "com.facundo.pulso", sourceName: "Pulso", externalRef: torso.id });
    const ownDev = workout("own-dev", "walking", at(13, 45), 9, { sourceBundle: "com.facundo.pulso.dev", energy: 60 });
    const ownCardio = workout("own-cardio", "running", at(13, 45), 9, { sourceBundle: null, externalRef: `${torso.id}-0`, energy: 60 });
    const { bySession, sessionOf, hidden } = attach([torso], [own, ownDev, ownCardio, fuerza], new Map());
    expect([...hidden].sort()).toEqual(["own", "own-cardio", "own-dev"]);
    expect(bySession.get(torso.id)?.map((a) => a.workout.id)).toEqual(["fuerza"]);
    expect(sessionOf.get("own-cardio")).toBe(torso.id);
  });

  test("a session id that itself ends in digits still matches, whole or with its block suffix", () => {
    const ids = new Set(["4C1F-000000000012"]);
    expect(isPulsoWritten({ sourceBundle: null, externalRef: "4C1F-000000000012" }, ids)).toBe(true);
    expect(isPulsoWritten({ sourceBundle: null, externalRef: "4C1F-000000000012-1" }, ids)).toBe(true);
    expect(isPulsoWritten({ sourceBundle: null, externalRef: "someone-else" }, ids)).toBe(false);
    expect(isPulsoWritten({ sourceBundle: "com.facundo.pulsometer", externalRef: null }, ids)).toBe(false);
  });

  test("hidden even when its session is outside what was read", () => {
    const own = workout("own", "strength", at(9, 0), 40, { sourceBundle: "com.facundo.pulso" });
    expect(attach([], [own], new Map()).hidden.has("own")).toBe(true);
  });
});

describe("what the session gets", () => {
  const parts = [part(fuerza, "overlap"), part(caminata, "overlap")];

  test("duration from the union, kcal summed once, heart rate weighted by length", () => {
    const r = recording({ ...torso, startedAt: at(13, 25) }, parts);
    expect(r.startedAt).toBe(at(13, 22));
    expect(r.endedAt).toBe(at(14, 1));
    expect(r.energy).toBe(201);
    expect(r.distance).toBe(490);
    expect(r.avgHeartRate).toBe(Math.round((118 * 19 + 104 * 9) / 28));
    expect(r.maxHeartRate).toBe(151);
    expect(recording(torso, []).energy).toBeNull();
  });

  test("the walk fills the empty cardio block; what the person typed stays", () => {
    const block = (extra: Partial<CardioLog>): CardioLog => ({
      exerciseId: "caminadora", durationSeconds: 540, distanceKm: null, level: null, inclinePercent: null, avgHr: null, kcal: null, doneAt: at(13, 54), ...extra,
    });
    const [filled] = fillCardio([block({})], parts);
    expect(filled).toMatchObject({ durationSeconds: 540, distanceKm: 0.49, kcal: 67, avgHr: 104, recordedBy: "caminata" });
    const [typed] = fillCardio([block({ kcal: 50, distanceKm: 0.6 })], parts);
    expect(typed).toMatchObject({ kcal: 50, distanceKm: 0.6, avgHr: 104 });
    // An unlogged block (no minutes) takes the walk's.
    expect(fillCardio([block({ durationSeconds: 0, doneAt: at(14, 0) })], parts)[0]!.durationSeconds).toBe(540);
    // The strength workout is not cardio: nothing for a block to take from it.
    expect(fillCardio([block({})], [part(fuerza, "overlap")])[0]!.recordedBy).toBeUndefined();
  });
});

describe("through the database", () => {
  const input = (w: Workout, extra: Partial<WorkoutInput> = {}): WorkoutInput => ({
    externalId: w.id, activity: w.activity, startedAt: w.startedAt, endedAt: w.endedAt, energy: w.energy, distance: w.distance,
    sourceBundle: w.sourceBundle, sourceName: w.sourceName, externalRef: w.externalRef ?? null, avgHeartRate: w.avgHeartRate ?? null, maxHeartRate: w.maxHeartRate ?? null, ...extra,
  });
  const run = workout("merge-run", "running", at(10, 0), 30, { energy: 300, distance: 5000 });
  const ownCopy = workout("merge-own", "strength", torso.startedAt, 41, { sourceBundle: "com.facundo.pulso", sourceName: "Pulso", externalRef: torso.id });
  const idOf = (externalId: string) => db().query<{ id: string }, [string]>("SELECT id FROM workouts WHERE external_id = ?").get(externalId)!.id;

  const clear = () => {
    db().run("DELETE FROM workouts WHERE started_at >= ? AND started_at < ?", [at(0, 0), at(23, 59)]);
    db().run("DELETE FROM training_sessions WHERE id LIKE 'merge-%'");
  };
  afterAll(clear);
  beforeEach(() => {
    clear();
    saveSession({
      id: torso.id, name: "Torso A", startedAt: torso.startedAt, endedAt: torso.endedAt,
      sets: [],
      cardio: [{ exerciseId: "caminadora", durationSeconds: 540, distanceKm: null, level: null, inclinePercent: null, avgHr: null, kcal: 40, doneAt: at(13, 54) }],
    });
    upsertHealthKitWorkouts([
      input(fuerza, { externalId: "merge-fuerza", heartRate: [{ at: at(13, 23), bpm: 110 }, { at: at(13, 30), bpm: 140 }] }),
      input(caminata, { externalId: "merge-caminata", heartRate: [{ at: at(13, 46), bpm: 100 }] }),
      input(ownCopy, { externalId: "merge-own" }),
      input(run, { externalId: "merge-run" }),
    ]);
  });

  test("three recordings of one workout read as one session; the run stays its own row", () => {
    const today = recentActivity(100).filter((a) => a.startedAt >= at(0, 0) && a.startedAt < at(23, 59));
    expect(today.map((a) => [a.kind, a.title])).toEqual([["session", "Torso A"], ["workout", "Carrera"]]);
    const session = today[0]!;
    expect(session).toMatchObject({ merged: true, startedAt: at(13, 20), endedAt: at(14, 1), sets: 0 });
    // The Watch's kcal, once: not the cardio log's 40 on top, not Pulso's copy.
    expect(session.energy).toBe(201);
    expect(session.parts.map((p) => p.title)).toEqual(["Fuerza", "Caminata"]);
    const alone = standaloneWorkouts(200).map((w) => w.externalId);
    expect(alone).toContain("merge-run");
    expect(alone).not.toContain("merge-fuerza");
    expect(alone).not.toContain("merge-own");
    // Pulso's 41-min strength copy overlaps the Watch's: still never taken for a second recording of it.
    const dupes = db().query<{ external_id: string; duplicate_of: string | null }, []>("SELECT external_id, duplicate_of FROM workouts WHERE external_id LIKE 'merge-%'").all();
    expect(dupes.every((d) => d.duplicate_of === null)).toBe(true);
  });

  test("the session's detail has the heart rate, the filled cardio block and what could be joined", () => {
    const detail = mergedSessionDetail(torso.id)!;
    expect(detail.merged).toBe(true);
    expect(detail.recorded?.heartRate.map((p) => p.bpm)).toEqual([110, 140, 100]);
    expect(detail.cardio[0]).toMatchObject({ kcal: 40, distanceKm: 0.49, recordedBy: idOf("merge-caminata") });
    expect(detail.joinable?.map((j) => [j.title, j.joinedTo])).toEqual([["Carrera", null]]);
    expect(listMergedSessions(50).find((s) => s.id === torso.id)?.recorded?.heartRate).toEqual([]);
  });

  test("Separar keeps a part apart, Unir con… joins another, and dropping the say goes back to matching", () => {
    const walkId = idOf("merge-caminata");
    const runId = idOf("merge-run");
    const separated = linkWorkout(walkId, null)!;
    expect(separated.id).toBe(torso.id);
    expect(separated.recorded?.parts.map((p) => p.title)).toEqual(["Fuerza"]);
    expect(separated.cardio[0]!.recordedBy).toBeUndefined();
    expect(standaloneWorkouts(200).map((w) => w.id)).toContain(walkId);

    const joined = linkWorkout(runId, torso.id)!;
    expect(joined.recorded?.parts.map((p) => [p.title, p.link])).toEqual([["Carrera", "manual"], ["Fuerza", "overlap"]]);
    expect(joined.recorded?.startedAt).toBe(at(10, 0));
    expect(standaloneWorkouts(200).map((w) => w.id)).not.toContain(runId);

    expect(unlinkWorkout(walkId)?.recorded?.parts.map((p) => p.title)).toEqual(["Carrera", "Fuerza", "Caminata"]);
    expect(unlinkWorkout(runId)?.recorded?.parts.map((p) => p.title)).toEqual(["Fuerza", "Caminata"]);
  });

  test("Pulso's own copy can't be moved, and unknown ids are refused", () => {
    expect(() => linkWorkout(idOf("merge-own"), null)).toThrow("Pulso's own copy");
    expect(() => linkWorkout("nope", null)).toThrow("no such workout");
    expect(() => linkWorkout(idOf("merge-run"), "nope")).toThrow("no such session");
  });
});

test("the phone's metadata and heart rate are accepted, malformed series refused", () => {
  const base = { externalId: "x", activity: "walking", startedAt: 0, endedAt: 60_000, energy: null, distance: null };
  expect(parseWorkoutInputs({ workouts: [{ ...base, externalRef: "s-1", avgHeartRate: 110, maxHeartRate: 150, heartRate: [{ at: 1, bpm: 100 }] }] })?.[0]).toMatchObject({
    externalRef: "s-1", avgHeartRate: 110, heartRate: [{ at: 1, bpm: 100 }],
  });
  expect(parseWorkoutInputs({ workouts: [base] })?.[0]).toMatchObject({ externalRef: null, heartRate: null });
  expect(parseWorkoutInputs({ workouts: [{ ...base, heartRate: [{ at: "x", bpm: 1 }] }] })).toBeUndefined();
  expect(parseWorkoutInputs({ workouts: [{ ...base, avgHeartRate: "fast" }] })).toBeUndefined();
});
