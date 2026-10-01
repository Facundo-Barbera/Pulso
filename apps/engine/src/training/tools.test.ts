import { expect, test } from "bun:test";
import { TOOLS } from "../agent/registry";
import { clearLive, putLive } from "./live";
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
  for (const name of [
    "list_exercises",
    "get_exercise",
    "create_program",
    "get_active_program",
    "list_sessions",
    "exercise_history",
    "suggest_next_loads",
    "log_session",
    "edit_program_day",
    "swap_program_exercise",
    "find_similar_exercises",
    "get_training_preferences",
    "set_training_preferences",
    "get_live_session",
    "edit_live_session",
  ]) {
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

test("este remo en libras → its unit sticks; the default changes alone", async () => {
  expect((await call("set_exercise_unit", { exerciseId: "remo-maquina", unit: "lb" })).data.exerciseUnits).toEqual({ "remo-maquina": "lb" });
  expect((await call("set_training_preferences", { defaultUnit: "lb" })).data).toMatchObject({ defaultUnit: "lb", exerciseUnits: { "remo-maquina": "lb" } });
  expect((await call("get_training_preferences", {})).data.defaultUnit).toBe("lb");
  expect((await call("set_exercise_unit", { exerciseId: "nope", unit: "lb" })).isError).toBe(true);
  await call("set_exercise_unit", { exerciseId: "remo-maquina", unit: null });
  await call("set_training_preferences", { defaultUnit: "kg" });
});

test("prefiero máquinas → preferences → machine alternatives first → swap for good in every day", async () => {
  expect((await call("set_training_preferences", { preferredEquipment: ["machine", "cable", "machine"] })).data).toEqual({ preferredEquipment: ["machine", "cable"], defaultUnit: "kg", exerciseUnits: {} });
  expect((await call("get_training_preferences", {})).data.preferredEquipment).toEqual(["machine", "cable"]);

  const similar = await call("find_similar_exercises", { exerciseId: "sentadilla", limit: 3 });
  expect(similar.data[0].equipment).toBe("machine");
  expect(similar.data[0].reasons).toContain("Mismo músculo");

  const created = await call("create_program", {
    name: "Pierna x2",
    goal: "Piernas",
    weeks: 4,
    activate: true,
    days: [
      { name: "Pierna A", exercises: [{ exerciseId: "sentadilla", sets: 4, repMin: 6, repMax: 8, restSeconds: 150 }, { exerciseId: "remo-barra", sets: 3, repMin: 8, repMax: 10, restSeconds: 120 }] },
      { name: "Pierna B", exercises: [{ exerciseId: "sentadilla", sets: 3, repMin: 8, repMax: 10, restSeconds: 120 }, { exerciseId: "eliptica", cardio: { durationMinutes: 15, zone: 2 } }] },
    ],
  });
  expect(created.isError).toBe(false);
  const swapped = await call("swap_program_exercise", { from: "sentadilla", to: "prensa", scope: "always" });
  expect(swapped.data).toEqual({ scope: "always", to: "Prensa de piernas", days: ["Pierna A", "Pierna B"] });
  const program = (await call("get_active_program", {})).data.program;
  expect(program.days.map((d: { exercises: { exerciseId: string; sets: number }[] }) => [d.exercises[0]!.exerciseId, d.exercises[0]!.sets])).toEqual([
    ["prensa", 4],
    ["prensa", 3],
  ]);
  expect(program.days[1].exercises[1].cardio).toEqual({ durationMinutes: 15, zone: 2 });

  // "Quita el remo del día 1", para siempre: the whole list without it, ids kept.
  const day = program.days[0];
  const edited = await call("edit_program_day", { dayId: day.id, scope: "always", exercises: [{ ...day.exercises[0], id: day.exercises[0].id }] });
  expect(edited.data.program.days[0].exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(["prensa"]);
  expect(edited.data.program.days[0].exercises[0].id).toBe(day.exercises[0].id);

  expect((await call("swap_program_exercise", { from: "sentadilla", to: "prensa", scope: "always" })).isError).toBe(true);
  await call("set_training_preferences", { preferredEquipment: [] });
});

test("create_program takes supersets and swap_program_exercise keeps the swapped-in exercise in the pair", async () => {
  const created = await call("create_program", {
    name: "Torso superseries",
    goal: "Hipertrofia",
    weeks: 4,
    activate: true,
    days: [
      {
        name: "Torso",
        exercises: [
          { exerciseId: "press-banca", sets: 3, repMin: 6, repMax: 8, restSeconds: 120, supersetId: "a" },
          { exerciseId: "remo-barra", sets: 3, repMin: 8, repMax: 10, restSeconds: 120, supersetId: "a" },
          { exerciseId: "elevaciones-laterales", sets: 3, repMin: 12, repMax: 15, restSeconds: 60 },
        ],
      },
    ],
  });
  expect(created.data.days[0].exercises.map((e: { supersetId: string | null }) => e.supersetId)).toEqual(["a", "a", null]);
  for (const scope of ["today", "always"]) {
    expect((await call("swap_program_exercise", { from: "press-banca", to: "press-pecho-maquina", scope })).isError).toBe(false);
  }
  const program = (await call("get_active_program", {})).data.program;
  expect(program.days[0].exercises.map((e: { exerciseId: string; supersetId: string | null }) => [e.exerciseId, e.supersetId])).toEqual([
    ["press-pecho-maquina", "a"],
    ["remo-barra", "a"],
    ["elevaciones-laterales", null],
  ]);
});

test("the Coach sees and changes the session in progress", async () => {
  expect((await call("get_live_session", {})).data).toEqual({ session: null });
  expect((await call("edit_live_session", { ops: [{ op: "skip", exercise: 1 }] })).isError).toBe(true);
  putLive(
    {
      id: "tools-live",
      programId: null,
      dayId: null,
      name: "Torso",
      startedAt: Date.now(),
      exercises: [
        { id: "x", exerciseId: "press-banca", name: "Press de banca", equipment: "barbell", kind: "compound", repMin: 6, repMax: 8, targetRpe: null, targetRir: null, restSeconds: 120, notes: null, hint: null, sets: [{ id: "s", weightKg: 60, reps: 8, rpe: null, doneAt: null }], cardio: null, cardioLog: null, skipped: false, supersetId: null },
      ],
      focus: 0,
      restStartedAt: null,
      restEndsAt: null,
      version: 0,
      updatedAt: 0,
      threadId: null,
    },
    0,
  );
  const changed = await call("edit_live_session", { ops: [{ op: "swap", exercise: "current", toExerciseId: "press-pecho-maquina" }] });
  expect(changed.data.changes).toEqual(["Press de banca → Press de pecho en máquina"]);
  expect((await call("get_live_session", {})).data.session.exercises[0].exerciseId).toBe("press-pecho-maquina");
  clearLive();
});
