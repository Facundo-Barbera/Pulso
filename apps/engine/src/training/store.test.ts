import { describe, expect, test } from "bun:test";
import type { ProgramInput, SessionInput } from "@pulso/contract";
import { LIBRARY } from "./library";
import {
  activeProgramView,
  createProgram,
  exerciseHistory,
  getActiveProgram,
  getProgram,
  listExercises,
  listSessions,
  nextDay,
  saveSession,
  TrainingError,
} from "./store";

const program = (overrides: Partial<ProgramInput> = {}): ProgramInput => ({
  name: "Torso / Pierna",
  goal: "Fuerza e hipertrofia",
  weeks: 8,
  days: [
    {
      name: "Torso A",
      exercises: [
        { exerciseId: "press-inclinado-barra", sets: 3, repMin: 6, repMax: 8, targetRir: 2, restSeconds: 180 },
        { exerciseId: "remo-polea-baja", sets: 3, repMin: 8, repMax: 12, restSeconds: 120, notes: "Pausa arriba" },
      ],
    },
    { name: "Pierna A", focus: "Sentadilla", exercises: [{ exerciseId: "sentadilla-hack", sets: 4, repMin: 6, repMax: 10, targetRpe: 8, restSeconds: 180 }] },
    { name: "Torso B", exercises: [{ exerciseId: "press-militar", sets: 3, repMin: 5, repMax: 8, restSeconds: 150 }] },
  ],
  ...overrides,
});

const session = (overrides: Partial<SessionInput> & Pick<SessionInput, "id" | "startedAt" | "sets">): SessionInput => ({
  name: "Sesión",
  endedAt: overrides.startedAt + 3_600_000,
  ...overrides,
});

const sets = (exerciseId: string, at: number, work: [number, number][]) =>
  work.map(([weightKg, reps], setIndex) => ({ exerciseId, setIndex, weightKg, reps, rpe: null, doneAt: at + setIndex }));

test("the library is seeded with ~60 exercises with Spanish names", () => {
  const all = listExercises();
  expect(all.length).toBe(LIBRARY.length);
  expect(all.length).toBeGreaterThanOrEqual(60);
  expect(all.find((e) => e.id === "press-banca")).toEqual({
    id: "press-banca",
    name: "Press de banca",
    muscle: "chest",
    secondary: ["triceps", "shoulders"],
    equipment: "barbell",
    kind: "compound",
  });
});

test("listExercises filters by muscle (primary or secondary), equipment and name", () => {
  expect(listExercises({ muscle: "biceps" }).map((e) => e.id)).toContain("dominadas");
  expect(listExercises({ equipment: "kettlebell" }).every((e) => e.equipment === "kettlebell")).toBe(true);
  expect(listExercises({ query: "Remo" }).map((e) => e.id)).toContain("remo-barra");
});

describe("createProgram", () => {
  test("writes the whole structure in order and makes it the only active program", () => {
    const first = createProgram(program({ name: "Viejo" }));
    const created = createProgram(program());
    expect(getProgram(first.id)?.active).toBe(false);
    expect(getActiveProgram()?.id).toBe(created.id);
    expect(created.days.map((d) => d.name)).toEqual(["Torso A", "Pierna A", "Torso B"]);
    expect(created.days[0]?.exercises[1]).toMatchObject({
      exerciseId: "remo-polea-baja",
      exerciseName: "Remo en polea baja",
      equipment: "cable",
      sets: 3,
      repMin: 8,
      repMax: 12,
      targetRpe: null,
      targetRir: null,
      restSeconds: 120,
      notes: "Pausa arriba",
    });
    expect(created.days[1]).toMatchObject({ focus: "Sentadilla", weekday: null });
  });

  test("activate false keeps the current active program", () => {
    const active = createProgram(program());
    const draft = createProgram(program({ name: "Borrador" }), false);
    expect(getActiveProgram()?.id).toBe(active.id);
    expect(draft.active).toBe(false);
  });

  test("rejects unknown exercises and inverted rep ranges without writing anything", () => {
    const active = getActiveProgram()?.id;
    const bad = program({ days: [{ name: "X", exercises: [{ exerciseId: "press-inventado", sets: 3, repMin: 8, repMax: 12, restSeconds: 90 }] }] });
    expect(() => createProgram(bad)).toThrow(TrainingError);
    expect(() => createProgram(bad)).toThrow(/press-inventado/);
    const inverted = program({ days: [{ name: "X", exercises: [{ exerciseId: "press-banca", sets: 3, repMin: 12, repMax: 8, restSeconds: 90 }] }] });
    expect(() => createProgram(inverted)).toThrow(/repMin/);
    expect(getActiveProgram()?.id).toBe(active);
  });
});

describe("nextDay", () => {
  test("rotates after the last day done from the program, wrapping around", () => {
    const p = createProgram(program());
    const [a, b, c] = p.days;
    expect(nextDay(p)?.id).toBe(a!.id);
    saveSession(session({ id: "rot-1", programId: p.id, dayId: a!.id, startedAt: 5_000_000, sets: [] }));
    expect(nextDay(p)?.id).toBe(b!.id);
    saveSession(session({ id: "rot-2", programId: p.id, dayId: c!.id, startedAt: 6_000_000, sets: [] }));
    expect(nextDay(p)?.id).toBe(a!.id);
  });

  test("a day pinned to today's weekday wins", () => {
    const monday = new Date(2026, 8, 28, 10).getTime();
    const p = createProgram(program({ days: [...program().days.slice(0, 2), { ...program().days[2]!, weekday: 1 }] }));
    expect(nextDay(p, monday)?.name).toBe("Torso B");
    expect(nextDay(p, monday + 86_400_000)?.name).toBe("Torso A");
  });
});

describe("saveSession", () => {
  test("stores sets, upserts on retry and reports records only against earlier sessions", () => {
    const t0 = 10_000_000;
    const first = saveSession(session({ id: "pr-1", startedAt: t0, sets: sets("curl-predicador", t0, [[30, 10], [30, 9]]) }));
    expect(first.prs).toEqual([]);

    const t1 = t0 + 86_400_000;
    const second = session({ id: "pr-2", startedAt: t1, sets: sets("curl-predicador", t1, [[32.5, 8], [30, 10]]) });
    const saved = saveSession(second);
    expect(saved.prs.map((r) => r.kind).sort()).toEqual(["e1rm", "weight"]);
    expect(saved.session.sets).toHaveLength(2);

    // The phone retrying the same session replaces it instead of duplicating.
    saveSession(second);
    expect(listSessions(100, "curl-predicador").map((s) => s.id)).toEqual(["pr-2", "pr-1"]);
  });

  test("re-indexes sets per exercise whatever the client sent", () => {
    const saved = saveSession(
      session({
        id: "idx",
        startedAt: 20_000_000,
        sets: [
          { exerciseId: "curl-polea", setIndex: 0, weightKg: 20, reps: 12, rpe: 8, doneAt: 1 },
          { exerciseId: "curl-polea", setIndex: 0, weightKg: 20, reps: 11, rpe: null, doneAt: 2 },
        ],
      }),
    );
    expect(saved.session.sets.map((s) => s.setIndex)).toEqual([0, 1]);
    expect(saved.session.sets[0]?.rpe).toBe(8);
  });

  test("rejects unknown exercises", () => {
    expect(() => saveSession(session({ id: "bad", startedAt: 1, sets: sets("nope", 1, [[10, 10]]) }))).toThrow(/nope/);
  });
});

test("exerciseHistory returns one point per session, oldest first, with all-time bests", () => {
  const t0 = 30_000_000;
  saveSession(session({ id: "h-1", startedAt: t0, sets: sets("curl-inclinado", t0, [[12, 10], [12, 8]]) }));
  saveSession(session({ id: "h-2", startedAt: t0 + 1_000, sets: sets("curl-inclinado", t0 + 1_000, [[14, 8]]) }));
  const history = exerciseHistory("curl-inclinado")!;
  expect(history.points.map((p) => p.sessionId)).toEqual(["h-1", "h-2"]);
  expect(history.points[0]).toMatchObject({ topWeightKg: 12, bestE1rm: 16, totalReps: 18, volumeKg: 216 });
  expect(history.heaviestKg).toBe(14);
  expect(history.bestE1rm).toBe(17.7);
  expect(exerciseHistory("nope")).toBeUndefined();
});

test("activeProgramView suggests loads from the last session by double progression", () => {
  const p = createProgram(
    program({ days: [{ name: "Brazos", exercises: [{ exerciseId: "patada-triceps", sets: 2, repMin: 10, repMax: 12, restSeconds: 60 }] }] }),
  );
  const exerciseId = p.days[0]!.exercises[0]!.id;
  expect(activeProgramView().suggestions[exerciseId]).toMatchObject({ weightKg: null, reps: 10 });

  saveSession(session({ id: "sg-1", programId: p.id, dayId: p.days[0]!.id, startedAt: 40_000_000, sets: sets("patada-triceps", 40_000_000, [[8, 12], [8, 12]]) }));
  const view = activeProgramView();
  expect(view.program?.id).toBe(p.id);
  expect(view.nextDayId).toBe(p.days[0]!.id);
  expect(view.suggestions[exerciseId]).toMatchObject({ weightKg: 10, reps: 10, lastSessionAt: 40_000_000 });
});
