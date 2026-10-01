import { expect, test } from "bun:test";
import { TOOLS } from "../agent/registry";
import { proposeMedia } from "./media";
import { trainingTools } from "./tools";

const call = async (name: string, args: Record<string, unknown>) => {
  const found = trainingTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  const result = await found.handler(args as never, undefined);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  return { isError: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) };
};

test("every training tool is registered with the agent", () => {
  const names = TOOLS.map((t) => t.name);
  for (const name of ["list_exercises", "get_exercise", "create_program", "get_active_program", "list_sessions", "exercise_history", "suggest_next_loads", "log_session"]) {
    expect(names).toContain(name);
  }
});

test("list_exercises filters", async () => {
  const { data } = await call("list_exercises", { equipment: "kettlebell" });
  expect(data.map((e: { id: string }) => e.id).sort()).toEqual(["sentadilla-goblet", "swing-kettlebell"]);
});

test("create_program → get_active_program → log_session → suggest_next_loads", async () => {
  const created = await call("create_program", {
    name: "Full body 3×",
    goal: "Base de fuerza",
    weeks: 6,
    activate: true,
    days: [
      { name: "Día A", exercises: [{ exerciseId: "press-arnold", sets: 2, repMin: 8, repMax: 10, targetRir: 2, restSeconds: 90 }] },
      { name: "Día B", exercises: [{ exerciseId: "zancadas", sets: 3, repMin: 10, repMax: 12, restSeconds: 90 }] },
    ],
  });
  expect(created.isError).toBe(false);

  const active = await call("get_active_program", {});
  expect(active.data.program.id).toBe(created.data.id);
  const dayA = created.data.days[0];
  expect(active.data.nextDayId).toBe(dayA.id);

  const logged = await call("log_session", {
    name: "Día A",
    startedAt: "2026-09-29T18:00:00+02:00",
    durationMinutes: 50,
    dayId: dayA.id,
    sets: [
      { exerciseId: "press-arnold", weightKg: 16, reps: 10 },
      { exerciseId: "press-arnold", weightKg: 16, reps: 10, rpe: 9 },
    ],
  });
  expect(logged.data.session).toMatchObject({ programId: created.data.id, dayId: dayA.id, startedAt: Date.parse("2026-09-29T16:00:00Z") });
  expect(logged.data.session.sets.map((s: { setIndex: number }) => s.setIndex)).toEqual([0, 1]);

  // The rotation moved on to day B; asking for day A explicitly gets the progression.
  expect((await call("suggest_next_loads", {})).data.dayName).toBe("Día B");
  const next = await call("suggest_next_loads", { dayId: dayA.id });
  expect(next.data.suggestions[dayA.exercises[0].id]).toMatchObject({ weightKg: 18, reps: 8 });

  const history = await call("exercise_history", { exerciseId: "press-arnold", limit: 10 });
  expect(history.data.points).toHaveLength(1);
  const sessions = await call("list_sessions", { limit: 5, exerciseId: "press-arnold" });
  expect(sessions.data[0].id).toBe(logged.data.session.id);
});

test("caller mistakes come back as tool errors the model can act on", async () => {
  const bad = await call("create_program", {
    name: "X",
    goal: "Y",
    weeks: 4,
    activate: true,
    days: [{ name: "D", exercises: [{ exerciseId: "sentadilla-espacial", sets: 3, repMin: 5, repMax: 5, restSeconds: 120 }] }],
  });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain("sentadilla-espacial");
  expect((await call("exercise_history", { exerciseId: "nope", limit: 5 })).isError).toBe(true);
  expect((await call("suggest_next_loads", { dayId: "not-a-day" })).isError).toBe(true);
});

test("get_exercise returns the detail; list_exercises says which have media", async () => {
  proposeMedia("swing-kettlebell", "UHJlbu3", 1);
  const { data } = await call("list_exercises", { equipment: "kettlebell" });
  expect(Object.fromEntries(data.map((e: { id: string; hasMedia: boolean }) => [e.id, e.hasMedia]))).toEqual({ "sentadilla-goblet": false, "swing-kettlebell": true });

  const detail = await call("get_exercise", { exerciseId: "swing-kettlebell" });
  expect(detail.data.primaryMuscles).toEqual(["glutes", "hamstrings"]);
  expect(detail.data.instructions.length).toBeGreaterThanOrEqual(3);
  expect(detail.data.media.source).toBe("exercisedb");
  expect((await call("get_exercise", { exerciseId: "nope" })).isError).toBe(true);
});
