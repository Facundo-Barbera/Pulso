import { expect, test } from "bun:test";
import type { PlanDay } from "./entreno";
import { fromUnit } from "../training/units";
import { addDrop, addSet, current, editDrop, editSet, extendRest, parseLive, removeDrop, removeSet, sessionId, setsDone, setsTotal, setUnit, skipRest, startSession, stepDropWeight, stepWeight, toggleSet, toSessionInput, volumeKg } from "./entreno-live";

const exercise = (id: string, exerciseId: string, sets: number, weightKg: number | null, unit = "kg") =>
  ({ id, exerciseId, exerciseName: exerciseId, sets, repMin: 6, repMax: 8, restSeconds: 90, unit, notes: null, target: `${sets} × 6–8`, suggestion: weightKg === null ? null : { exerciseId, weightKg, reps: 8, reason: "Sube", lastSessionAt: null } }) as never;

const day = { id: "d1", name: "Torso A", exercises: [exercise("p1", "press-banca", 2, 60), exercise("p2", "remo-mancuerna", 2, null)] } as unknown as PlanDay;

test("a session starts from the day's suggestions, with 0 kg and the bottom of the range without history", () => {
  const s = startSession(day, "prog", 1000, "id-1");
  expect(s).toMatchObject({ id: "id-1", programId: "prog", dayId: "d1", name: "Torso A", startedAt: 1000 });
  expect(s.exercises[0]!.sets).toEqual([{ weightKg: 60, reps: 8, rpe: null, doneAt: null }, { weightKg: 60, reps: 8, rpe: null, doneAt: null }]);
  expect(s.exercises[1]!.sets[0]).toEqual({ weightKg: 0, reps: 6, rpe: null, doneAt: null });
  expect(s.exercises[0]!.hint).toBe("Sube");
  expect([setsDone(s), setsTotal(s)]).toEqual([0, 4]);
});

test("checking a set starts the rest and carries its load forward; the last set ends the rest", () => {
  let s = startSession(day, null, 0, "x");
  s = editSet(s, 0, 0, { weightKg: 62.5, rpe: 8 });
  s = toggleSet(s, 0, 0, 10_000);
  expect(s.exercises[0]!.sets[1]!.weightKg).toBe(62.5);
  expect([s.restStartedAt, s.restEndsAt]).toEqual([10_000, 100_000]);
  expect(current(s)).toEqual({ exercise: 0, set: 1 });
  expect(extendRest(s, 30, 20_000).restEndsAt).toBe(130_000);
  expect(skipRest(s).restEndsAt).toBeNull();
  // Un-checking clears the rest.
  expect(toggleSet(s, 0, 0, 11_000)).toMatchObject({ restEndsAt: null });
  s = toggleSet(s, 0, 1, 20_000);
  s = toggleSet(s, 1, 0, 30_000);
  s = toggleSet(s, 1, 1, 40_000);
  expect(current(s)).toBeNull();
  expect(s.restEndsAt).toBeNull();
  expect(volumeKg(s)).toBe(62.5 * 8 * 2);
});

test("loads step on the exercise's increment and numbers stay in range", () => {
  let s = startSession(day, null, 0, "x");
  s = stepWeight(s, 0, 0, 1);
  expect(s.exercises[0]!.sets[0]!.weightKg).toBe(62.5);
  s = stepWeight(s, 1, 0, -3);
  expect(s.exercises[1]!.sets[0]!.weightKg).toBe(0);
  s = editSet(s, 0, 0, { reps: 7.6, rpe: 14 });
  expect(s.exercises[0]!.sets[0]).toMatchObject({ reps: 8, rpe: 10 });
});

test("a pound machine steps by 5 lb, and switching unit moves only the sets still to do", () => {
  const lbDay = { id: "d2", name: "Espalda", exercises: [exercise("p1", "remo-maquina", 2, fromUnit(70, "lb"), "lb")] } as unknown as PlanDay;
  let s = startSession(lbDay, null, 0, "x");
  s = stepWeight(s, 0, 0, 1);
  expect(s.exercises[0]!.sets[0]!.weightKg).toBe(fromUnit(75, "lb"));
  s = stepWeight(s, 0, 0, -2);
  expect(s.exercises[0]!.sets[0]!.weightKg).toBe(fromUnit(65, "lb"));
  s = toggleSet(s, 0, 0, 1);
  s = setUnit(s, "remo-maquina", "kg");
  expect(s.exercises[0]!.unit).toBe("kg");
  // Done: what was lifted. To do: 65 lb (29,48 kg) on the nearest kilo plate.
  expect(s.exercises[0]!.sets.map((x) => x.weightKg)).toEqual([fromUnit(65, "lb"), 30]);
  // A session stored before units steps in kg.
  const old = { ...startSession(day, null, 0, "y") };
  old.exercises[0] = { ...old.exercises[0]!, unit: undefined };
  expect(stepWeight(old, 0, 0, 1).exercises[0]!.sets[0]!.weightKg).toBe(62.5);
});

test("sets can be added and spare ones removed, never a done one or the last", () => {
  let s = addSet(startSession(day, null, 0, "x"), 0);
  expect(s.exercises[0]!.sets).toHaveLength(3);
  s = toggleSet(s, 0, 0, 1);
  expect(removeSet(s, 0, 0)).toBe(s);
  expect(removeSet(s, 0, 2).exercises[0]!.sets).toHaveLength(2);
});

test("the stored session holds done sets only, numbered per exercise in the order done", () => {
  let s = startSession(day, "prog", 0, "x");
  s = toggleSet(s, 1, 0, 5);
  s = toggleSet(s, 0, 1, 10);
  s = toggleSet(s, 0, 0, 20);
  const input = toSessionInput(s, 99);
  expect(input).toMatchObject({ id: "x", programId: "prog", dayId: "d1", name: "Torso A", startedAt: 0, endedAt: 99 });
  expect(input.sets.map((x) => [x.exerciseId, x.setIndex, x.doneAt])).toEqual([
    ["remo-mancuerna", 0, 5],
    ["press-banca", 0, 10],
    ["press-banca", 1, 20],
  ]);
});

test("ids look like UUIDs and a stored session survives a reload, anything else is dropped", () => {
  expect(sessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const s = startSession(day, null, 0, "x");
  expect(parseLive(JSON.stringify(s))).toEqual(s);
  expect(parseLive("{")).toBeNull();
  expect(parseLive('{"id":1}')).toBeNull();
  expect(parseLive(null)).toBeNull();
});

test("a set where the load dropped: the editor adds a lighter segment, volume counts it, the engine gets segments", () => {
  let s = startSession(day, null, 0, "drop");
  s = editSet(s, 0, 0, { weightKg: 80, reps: 4 });
  s = toggleSet(s, 0, 0, 10_000);
  // ~15 % lighter on the plate steps, for the reps missing to 6; the rest restarts after it.
  s = addDrop(s, 0, 0, 40_000);
  expect(s.exercises[0]!.sets[0]!.drops).toEqual([{ weightKg: 67.5, reps: 2 }]);
  expect([s.restStartedAt, s.restEndsAt]).toEqual([40_000, 130_000]);
  s = editDrop(s, 0, 0, 0, { weightKg: 60, reps: 3 });
  expect(volumeKg(s)).toBe(80 * 4 + 60 * 3);
  expect(toSessionInput(s, 200_000).sets[0]).toMatchObject({ weightKg: 80, reps: 4, segments: [{ weightKg: 80, reps: 4 }, { weightKg: 60, reps: 3 }] });
  // The next set doesn't inherit the drop; a set added after it neither.
  expect(s.exercises[0]!.sets[1]!.drops).toBeUndefined();
  expect(addSet(s, 0).exercises[0]!.sets.at(-1)!.drops).toBeUndefined();
  expect(stepDropWeight(s, 0, 0, 0, -1).exercises[0]!.sets[0]!.drops![0]!.weightKg).toBe(57.5);
  expect(editDrop(s, 0, 0, 0, { reps: 0 }).exercises[0]!.sets[0]!.drops![0]!.reps).toBe(1);
  expect(removeDrop(s, 0, 0, 0).exercises[0]!.sets[0]!.drops).toEqual([]);
  // A plain set goes as one segment.
  const plain = toggleSet(startSession(day, null, 0, "p"), 0, 0, 1);
  expect(toSessionInput(plain, 2).sets[0]!.segments).toEqual([{ weightKg: 60, reps: 8 }]);
});

test("a drop on a pound machine lands on 5 lb steps; one planned on an open set leaves the rest alone", () => {
  const lb = { id: "d2", name: "Máquina", exercises: [exercise("m", "remo-maquina", 2, fromUnit(100, "lb"), "lb")] } as unknown as PlanDay;
  let s = toggleSet(startSession(lb, null, 0, "lb"), 0, 0, 1_000);
  s = addDrop(s, 0, 1, 2_000);
  expect(s.exercises[0]!.sets[1]!.drops![0]!.weightKg).toBeCloseTo(fromUnit(85, "lb"), 9);
  expect(s.restStartedAt).toBe(1_000);
});
