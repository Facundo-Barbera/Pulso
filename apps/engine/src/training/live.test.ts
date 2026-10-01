import { beforeEach, expect, test } from "bun:test";
import type { LiveExercise, LiveSession } from "@pulso/contract";
import { providerEnv, resetProvider } from "../agent/provider";
import { agentOptions } from "../agent/runner";
import { getThread } from "../agent/threads";
import { clearLive, describeLive, editLive, getLive, putLive } from "./live";
import { liveCoachMode, liveCoachThread } from "./live-coach";
import { saveSession, setTrainingSettings, TrainingError } from "./store";

const T0 = new Date(2026, 9, 1, 18).getTime();

const strength = (id: string, exerciseId: string, name: string, sets: number, done = 0): LiveExercise => ({
  id,
  exerciseId,
  name,
  equipment: "barbell",
  kind: "compound",
  repMin: 6,
  repMax: 8,
  targetRpe: null,
  targetRir: 2,
  restSeconds: 120,
  notes: null,
  hint: null,
  sets: Array.from({ length: sets }, (_, i) => ({ id: `${id}-s${i}`, weightKg: 60, reps: 8, rpe: null, doneAt: i < done ? T0 + i * 60_000 : null })),
  cardio: null,
  cardioLog: null,
  skipped: false,
});

const session = (overrides: Partial<LiveSession> = {}): LiveSession => ({
  id: "live-1",
  programId: null,
  dayId: null,
  name: "Pierna A",
  startedAt: T0,
  exercises: [strength("a", "sentadilla", "Sentadilla", 3, 1), strength("b", "peso-muerto-rumano", "Peso muerto rumano", 3), strength("c", "zancadas", "Zancadas con mancuernas", 2)],
  focus: 0,
  restStartedAt: T0 + 60_000,
  restEndsAt: T0 + 180_000,
  version: 0,
  updatedAt: 0,
  threadId: null,
  ...overrides,
});

beforeEach(() => {
  clearLive();
  setTrainingSettings({ preferredEquipment: [] });
});

test("the phone's copy is stored with a bumped version; a stale write after the Coach's change is refused", () => {
  const first = putLive(session(), 0, T0);
  expect(first).toMatchObject({ ok: true, session: { version: 1, updatedAt: T0 } });
  const second = putLive({ ...session(), focus: 1 }, 1, T0 + 1);
  expect(second.ok && second.session.version).toBe(2);

  editLive([{ op: "skip", exercise: 3 }], T0 + 2);
  expect(getLive()!.version).toBe(3);
  // The phone still thinks it is on 2: refused, with the engine's copy to adopt.
  const stale = putLive({ ...session(), focus: 2 }, 2, T0 + 3);
  expect(stale.ok).toBe(false);
  expect(stale.session.exercises[2]!.skipped).toBe(true);
  expect(putLive({ ...stale.session, focus: 2 }, 3, T0 + 4).ok).toBe(true);

  // A new session replaces the old one; deleting forgets it.
  expect(putLive(session({ id: "live-2" }), 0, T0 + 5).ok).toBe(true);
  expect(getLive()!.id).toBe("live-2");
  expect(clearLive()).toBe(true);
  expect(getLive()).toBeNull();
});

test("swap: with sets done the old exercise keeps them and the new one takes the rest; without, it is replaced in place", () => {
  putLive(session(), 0, T0);
  const { session: s, changes } = editLive([{ op: "swap", exercise: "current", toExerciseId: "prensa" }], T0 + 1);
  expect(changes).toEqual(["Sentadilla → Prensa de piernas"]);
  expect(s.exercises.map((e) => e.exerciseId)).toEqual(["sentadilla", "prensa", "peso-muerto-rumano", "zancadas"]);
  expect(s.exercises[0]!.sets.length).toBe(1);
  expect(s.exercises[1]).toMatchObject({ equipment: "machine", repMin: 6, repMax: 8, restSeconds: 120, targetRir: 2 });
  expect(s.exercises[1]!.sets.length).toBe(2);
  expect(s.focus).toBe(1);
  // A swap ends the rest that belonged to the old set.
  expect(s.restEndsAt).toBeNull();

  const again = editLive([{ op: "swap", exercise: 3, toExerciseId: "curl-femoral-sentado" }], T0 + 2).session;
  expect(again.exercises[2]).toMatchObject({ id: "b", exerciseId: "curl-femoral-sentado", name: "Curl femoral sentado" });
  expect(() => editLive([{ op: "swap", exercise: 1, toExerciseId: "eliptica" }])).toThrow(/strength for strength/);
});

test("update, add (strength and cardio), move, skip and remove", () => {
  putLive(session(), 0, T0);
  let s = editLive([{ op: "update", exercise: "current", sets: 4, weightKg: 55, reps: 6 }], T0 + 1).session;
  expect(s.exercises[0]!.sets.map((x) => [x.weightKg, x.reps, x.doneAt != null])).toEqual([
    [60, 8, true],
    [55, 6, false],
    [55, 6, false],
    [55, 6, false],
  ]);
  // Fewer sets never drops one already done.
  s = editLive([{ op: "update", exercise: 1, sets: 1 }], T0 + 2).session;
  expect(s.exercises[0]!.sets.length).toBe(1);
  // …so the exercise is done and the focus moves on.
  expect(s.focus).toBe(1);

  s = editLive([{ op: "add", exerciseId: "bici-estatica", cardio: { durationMinutes: 10, zone: 2 } }, { op: "add", exerciseId: "extension-cuadriceps", position: 2, sets: 2 }], T0 + 3).session;
  expect(s.exercises.map((e) => e.exerciseId)).toEqual(["sentadilla", "extension-cuadriceps", "peso-muerto-rumano", "zancadas", "bici-estatica"]);
  expect(s.exercises[4]).toMatchObject({ kind: "cardio", modality: "bike", sets: [], cardio: { durationMinutes: 10, zone: 2 } });
  expect(s.exercises[1]!.sets.length).toBe(2);
  expect(s.focus).toBe(2);

  s = editLive([{ op: "move", exercise: 5, to: 1 }], T0 + 4).session;
  expect(s.exercises[0]!.exerciseId).toBe("bici-estatica");
  expect(s.exercises[s.focus]!.exerciseId).toBe("peso-muerto-rumano");

  s = editLive([{ op: "skip", exercise: "current" }, { op: "remove", exercise: "zancadas" }], T0 + 5).session;
  expect(s.exercises.find((e) => e.exerciseId === "peso-muerto-rumano")!.skipped).toBe(true);
  expect(s.exercises.map((e) => e.exerciseId)).not.toContain("zancadas");
  expect(() => editLive([{ op: "remove", exercise: "sentadilla" }])).toThrow(/skip it instead/);
  expect(() => editLive([{ op: "focus", exercise: 99 }])).toThrow(TrainingError);
});

test("changes are all or nothing", () => {
  putLive(session(), 0, T0);
  expect(() => editLive([{ op: "skip", exercise: 2 }, { op: "swap", exercise: 1, toExerciseId: "nope" }])).toThrow(/Unknown exercise/);
  expect(getLive()!.exercises[1]!.skipped).toBe(false);
  expect(getLive()!.version).toBe(1);
});

test("without a session in progress the Coach is told to edit the program instead", () => {
  expect(() => editLive([{ op: "skip", exercise: 1 }])).toThrow(/no session in progress/);
  expect(liveCoachThread()).toBeUndefined();
});

test("one Coach thread per session, in the short workout mode with only the gym tools", () => {
  putLive(session(), 0, T0);
  setTrainingSettings({ preferredEquipment: ["machine", "cable"] });
  const threadId = liveCoachThread()!;
  expect(getThread(threadId)!.title).toBe("Entreno · Pierna A · 1 oct");
  expect(liveCoachThread()).toBe(threadId);
  // The phone's next write doesn't unbind it.
  putLive({ ...session(), threadId: null }, 1, T0 + 1);
  expect(getLive()!.threadId).toBe(threadId);

  const mode = liveCoachMode(threadId, T0 + 25 * 60_000)!;
  expect(mode.context).toContain('Sesión "Pierna A", 25 min en marcha.');
  expect(mode.context).toContain("1. Sentadilla [sentadilla, barbell] — 3×6–8 · 60 kg · 1/3 series ← en pantalla");
  expect(mode.context).toContain("Preferred equipment: máquinas, poleas.");
  expect(mode.tools).toContain("edit_live_session");

  // A fake provider, so building the options never reads this Mac's Keychain or environment.
  providerEnv(() => undefined, { ANTHROPIC_API_KEY: "test" });
  const options = agentOptions("/tmp", mode.context, undefined, new AbortController(), mode);
  resetProvider();
  expect(typeof options.systemPrompt).toBe("string");
  expect(options.tools).toEqual([]);
  expect(options.maxTurns).toBeLessThanOrEqual(8);

  // Once the session is saved, the thread is a normal conversation again.
  saveSession({ id: "live-1", name: "Pierna A", startedAt: T0, endedAt: T0 + 3_600_000, sets: [] });
  expect(getLive()).toBeNull();
  expect(liveCoachMode(threadId)).toBeUndefined();
});

test("describeLive shows cardio targets and status", () => {
  const cardio: LiveExercise = {
    ...strength("z", "eliptica", "Elíptica", 0),
    kind: "cardio",
    equipment: "machine",
    sets: [],
    cardio: { durationMinutes: 20, zone: 2, intervals: { rounds: 6, workSeconds: 60, restSeconds: 60 } },
  };
  const text = describeLive(session({ exercises: [cardio], focus: 0 }), T0);
  expect(text).toContain("1. Elíptica [eliptica] — cardio 20 min · Z2 · 6×60s/60s ← en pantalla");
});
