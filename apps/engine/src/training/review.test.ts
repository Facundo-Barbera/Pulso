import { beforeEach, describe, expect, test } from "bun:test";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProgramInput } from "@pulso/contract";
import type { QueryFn } from "../agent/runner";
import { listMessages } from "../agent/threads";
import { addHealthEvent } from "../calendar/store";
import { db } from "../db";
import { ownDatabase } from "../web/test-db";
import { fallbackChanges, GUARDRAILS } from "./adjust";
import { claimDueReview, REVIEW_TOOLS, runDueReviews } from "./review";
import { breakLevel, detectSignals, usualGap } from "./signals";
import { activeProgramView, adjustmentThreadId, createProgram, dismissAdjustment, saveSession, setSessionAdjustment, trainingBlocks, TrainingError } from "./store";

ownDatabase("review");

const DAY = 86_400_000;
// Thursday 1 Oct 2026, 9:00 on the Mac's clock.
const NOW = new Date(2026, 9, 1, 9).getTime();

const input = (name = "Torso / Pierna"): ProgramInput => ({
  name,
  goal: "Hipertrofia",
  weeks: 6,
  days: [
    { name: "Torso A", exercises: [{ exerciseId: "press-banca", sets: 4, repMin: 6, repMax: 8, restSeconds: 120 }, { exerciseId: "remo-polea-baja", sets: 3, repMin: 8, repMax: 12, restSeconds: 90 }] },
    { name: "Pierna A", exercises: [{ exerciseId: "sentadilla-hack", sets: 4, repMin: 6, repMax: 10, restSeconds: 150 }] },
    { name: "Torso B", exercises: [{ exerciseId: "press-militar", sets: 3, repMin: 6, repMax: 8, restSeconds: 120 }] },
    { name: "Pierna B", exercises: [{ exerciseId: "peso-muerto-rumano", sets: 3, repMin: 8, repMax: 10, restSeconds: 120 }] },
  ],
});

let n = 0;
/** A session of `exerciseId` (4 × 8 at `kg`) on no program day. */
function lift(startedAt: number, exerciseId = "press-banca", kg = 80) {
  saveSession({
    id: `r-${++n}`,
    name: "Sesión",
    startedAt,
    endedAt: startedAt + 3_600_000,
    sets: [0, 1, 2, 3].map((i) => ({ exerciseId, setIndex: i, weightKg: kg, reps: 8, rpe: null, doneAt: startedAt + i })),
  });
}

/** Sessions every other day up to `until`, the usual rhythm of a four-day week. */
const rhythm = (until: number, count = 6) => Array.from({ length: count }, (_, i) => lift(until - (count - 1 - i) * 2 * DAY));

beforeEach(() => {
  db().run("DELETE FROM programs; DELETE FROM training_sessions; DELETE FROM session_adjustments; DELETE FROM health_events;");
});

const m = (message: object) => ({ session_id: "s", parent_tool_use_id: null, ...message }) as unknown as SDKMessage;
type Call = { prompt: string; options: Options };

/** A fake SDK turn: `act` stands in for the Coach's tool calls, then a result. */
function fakeCoach(act: () => void = () => {}, calls: Call[] = []): QueryFn {
  return (({ prompt, options }: Call) => {
    calls.push({ prompt, options });
    return (async function* () {
      await Bun.sleep(1);
      act();
      yield m({ type: "result", subtype: "success", is_error: false, result: "Listo." });
    })();
  }) as unknown as QueryFn;
}

const failing: QueryFn = (() =>
  (async function* () {
    throw new Error("provider down");
  })()) as unknown as QueryFn;

describe("signals", () => {
  test("a break is measured against the person's own rhythm", () => {
    const everyOtherDay = [0, 2, 4, 6, 8].map((d) => d * DAY);
    expect(usualGap(everyOtherDay, 4)).toBe(2);
    expect(usualGap([], 4)).toBe(1.75);
    expect(breakLevel(2, 2)).toBeNull();
    expect(breakLevel(6, 2)).toBeNull();
    expect(breakLevel(9, 2)).toBe("moderate");
    expect(breakLevel(9, 7)).toBeNull(); // once a week: 9 days is under 1.5 × 7
    expect(breakLevel(15, 2)).toBe("long");
    expect(breakLevel(30, 2)).toBe("very_long");
  });

  test("two days off in a four-day week is nothing; nine is a break", () => {
    const p = createProgram(input(), true, NOW - 30 * DAY);
    rhythm(NOW - 2 * DAY + 1);
    expect(detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW)).toEqual([]);
    db().run("DELETE FROM training_sessions");
    rhythm(NOW - 9 * DAY + 1);
    const [signal] = detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW);
    expect(signal).toMatchObject({ kind: "inactivity", level: "moderate", days: 9, detail: "Llevas 9 días sin entrenar (sueles descansar 2 días)" });
  });

  test("one exercise not trained for weeks, while the rest goes on", () => {
    const p = createProgram(input(), true, NOW - 30 * DAY);
    lift(NOW - 20 * DAY, "remo-polea-baja", 50);
    rhythm(NOW - DAY);
    const signals = detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "exercise_gap", level: "moderate", programExerciseId: p.days[0]!.exercises[1]!.id });
  });

  test("after a very long break the first sessions back still count, then stop", () => {
    const p = createProgram(input(), true, NOW - 90 * DAY);
    lift(NOW - 60 * DAY);
    lift(NOW - 2 * DAY);
    expect(detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW)[0]).toMatchObject({ kind: "inactivity", level: "returning", days: 58 });
    lift(NOW - DAY - 3_600_000);
    lift(NOW - DAY);
    expect(detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW).filter((s) => s.kind === "inactivity")).toEqual([]);
  });

  test("an injury, a new block and missed days are signals too", () => {
    createProgram(input("Antes"), true, NOW - 40 * DAY);
    const p = createProgram(input("CrossFit"), true, NOW - 3 * DAY);
    rhythm(NOW - DAY);
    addHealthEvent({ kind: "lesion", title: "Hombro", bodyArea: "shoulder", startDate: "2026-09-29", affectedTraining: "evitar press por encima de la cabeza" }, "2026-10-01");
    const kinds = detectSignals(p, p.days[0]!, trainingBlocks(NOW), NOW).map((s) => s.kind);
    expect(kinds).toEqual(["health_event", "block_switch"]);
  });
});

describe("review job", () => {
  test("a signal claims one review per upcoming session and set of signals", () => {
    createProgram(input(), true, NOW - 30 * DAY);
    rhythm(NOW - 9 * DAY);
    const first = claimDueReview(NOW);
    expect(first?.adjustment).toMatchObject({ status: "reviewing", signals: [{ kind: "inactivity" }] });
    expect(claimDueReview(NOW + 60_000)).toBeUndefined();
    // Something new (an injury) is worth another look.
    addHealthEvent({ kind: "lesion", title: "Rodilla", startDate: "2026-09-30" }, "2026-10-01");
    expect(claimDueReview(NOW + 120_000)?.adjustment.signals.map((s) => s.kind)).toEqual(["inactivity", "health_event"]);
  });

  test("no signal, no review", async () => {
    createProgram(input(), true, NOW - 30 * DAY);
    rhythm(NOW - DAY);
    expect(await runDueReviews(new Date(NOW), fakeCoach())).toEqual([]);
  });

  test("the Coach decides with the review's tools, and the next session shows it", async () => {
    const p = createProgram(input(), true, NOW - 30 * DAY);
    rhythm(NOW - 9 * DAY);
    const bench = p.days[0]!.exercises[0]!;
    const calls: Call[] = [];
    const [done] = await runDueReviews(
      new Date(NOW),
      fakeCoach(() => {
        setSessionAdjustment({ dayId: p.days[0]!.id, noChange: false, rationale: "Llevas 9 días sin entrenar: hoy 3 series y un 10 % menos.", changes: [{ action: "adjust", programExerciseId: bench.id, loadPercent: -10, sets: 3 }] }, NOW);
      }, calls),
    );
    expect(done).toMatchObject({ status: "ready", decidedBy: "coach", noChange: false });
    expect(calls[0]!.options.systemPrompt).toContain("Llevas 9 días sin entrenar (sueles descansar 2 días)");
    expect(calls[0]!.options.systemPrompt).toContain(`${bench.id} · Press de banca`);
    expect(calls[0]!.options.allowedTools).toEqual(["mcp__pulso"]);
    expect(REVIEW_TOOLS).toContain("set_session_adjustment");

    const view = activeProgramView(NOW);
    expect(view.adjustment).toMatchObject({ id: done!.id, rationale: "Llevas 9 días sin entrenar: hoy 3 series y un 10 % menos." });
    expect(view.adjustment!.day.exercises[0]!.sets).toBe(3);
    const s = view.adjustment!.suggestions[bench.id]!;
    expect(s.normal).toEqual({ weightKg: view.suggestions[bench.id]!.weightKg, reps: view.suggestions[bench.id]!.reps });
    expect(s.weightKg).toBe(75); // progression says 82,5 kg; −10 % = 74,25, on the 2,5 kg steps
    expect(s.reason).toContain("Ajuste para hoy");
    // The program itself is untouched.
    expect(view.program!.days[0]!.exercises[0]!.sets).toBe(4);
  });

  test("without a decision from the Coach the fallback table decides, and says so", async () => {
    const p = createProgram(input(), true, NOW - 60 * DAY);
    rhythm(NOW - 16 * DAY);
    const [silent] = await runDueReviews(new Date(NOW), fakeCoach());
    expect(silent).toMatchObject({ decidedBy: "fallback", status: "ready" });
    expect(silent!.rationale).toContain("Ajuste automático");
    expect(silent!.changes.find((c) => c.programExerciseId === p.days[0]!.exercises[0]!.id)).toMatchObject({ loadPercent: -20, reps: 6 });

    db().run("DELETE FROM session_adjustments");
    const [down] = await runDueReviews(new Date(NOW), failing);
    expect(down?.decidedBy).toBe("fallback");
  });

  test("the fallback table: strongest rule per exercise, health events change nothing on their own", () => {
    const day = createProgram(input(), true, NOW).days[0]!;
    const [bench, row] = day.exercises;
    const changes = fallbackChanges(day, [
      { kind: "inactivity", level: "moderate", days: 9, detail: "" },
      { kind: "exercise_gap", level: "long", days: 30, programExerciseId: row!.id, detail: "" },
    ]);
    expect(changes).toEqual([
      { action: "adjust", programExerciseId: bench!.id, loadPercent: -10, sets: null, reps: null },
      { action: "adjust", programExerciseId: row!.id, loadPercent: -20, sets: null, reps: row!.repMin },
    ]);
    expect(fallbackChanges(day, [{ kind: "health_event", level: "activa", days: null, detail: "" }])).toEqual([]);
    expect(fallbackChanges(day, [{ kind: "inactivity", level: "very_long", days: 40, detail: "" }])[0]).toMatchObject({ loadPercent: -30, sets: 3 });
  });
});

describe("guardrails", () => {
  const setup = () => {
    const p = createProgram(input(), true, NOW - 30 * DAY);
    rhythm(NOW - DAY);
    return { day: p.days[0]!, bench: p.days[0]!.exercises[0]!, row: p.days[0]!.exercises[1]! };
  };
  const set = (dayId: string, changes: Parameters<typeof setSessionAdjustment>[0]["changes"]) => () =>
    setSessionAdjustment({ dayId, noChange: false, rationale: "Hoy más suave.", changes }, NOW);

  test("out-of-bounds changes are refused with what to fix", () => {
    const { day, bench, row } = setup();
    expect(set(day.id, [{ action: "adjust", programExerciseId: bench.id, loadPercent: 5 }])).toThrow("never heavier");
    expect(set(day.id, [{ action: "adjust", programExerciseId: bench.id, loadPercent: -50 }])).toThrow(`under ${(GUARDRAILS.minLoadShare - 1) * 100}`);
    expect(set(day.id, [{ action: "adjust", programExerciseId: bench.id, sets: 5 }])).toThrow("never more than prescribed");
    expect(set(day.id, [{ action: "adjust", programExerciseId: bench.id, sets: 1 }])).toThrow("at most 2 sets fewer");
    expect(set(day.id, [{ action: "adjust", programExerciseId: bench.id, reps: 12 }])).toThrow("within 6–8");
    expect(set(day.id, [{ action: "swap", programExerciseId: bench.id, toExerciseId: "caminadora" }])).toThrow("same kind");
    expect(set(day.id, [{ action: "skip", programExerciseId: bench.id }, { action: "skip", programExerciseId: row.id }])).toThrow(TrainingError);
    expect(set(day.id, [{ action: "add", programExerciseId: null, toExerciseId: "press-banca" }])).toThrow("cardio warm-up");
    expect(set(day.id, [{ action: "add", programExerciseId: null, toExerciseId: "caminadora", cardio: { durationMinutes: 30 } }])).toThrow("at most 15 min");
    expect(set("nope", [])).toThrow("not in the active program");
    expect(activeProgramView(NOW).adjustment).toBeNull();
  });

  test("a swap, a skip and a warm-up within bounds apply to that session only", () => {
    const { day, bench, row } = setup();
    const adjusted = setSessionAdjustment(
      {
        dayId: day.id,
        noChange: false,
        rationale: "Te molesta el hombro: hoy press en máquina, sin remo y 8 min de cinta antes.",
        changes: [
          { action: "swap", programExerciseId: bench.id, toExerciseId: "press-pecho-maquina" },
          { action: "skip", programExerciseId: row.id },
          { action: "add", programExerciseId: null, toExerciseId: "caminadora", cardio: { durationMinutes: 8, zone: 1 } },
        ],
      },
      NOW,
    );
    expect(adjusted.day.exercises.map((e) => e.exerciseId)).toEqual(["caminadora", "press-pecho-maquina"]);
    expect(adjusted.day.exercises[1]!.id).toBe(bench.id);
    expect(adjusted.decidedBy).toBe("coach");
  });
});

test("Entrenar normal sets the adjustment aside, and back", () => {
  const p = createProgram(input(), true, NOW - 30 * DAY);
  rhythm(NOW - DAY);
  const adjusted = setSessionAdjustment({ dayId: p.days[0]!.id, noChange: false, rationale: "Hoy más suave.", changes: [{ action: "adjust", programExerciseId: p.days[0]!.exercises[0]!.id, loadPercent: -10 }] }, NOW);
  expect(dismissAdjustment(adjusted.id, true, NOW).adjustment?.dismissed).toBe(true);
  expect(dismissAdjustment(adjusted.id, false, NOW).adjustment?.dismissed).toBe(false);
  expect(() => dismissAdjustment("nope", true, NOW)).toThrow(TrainingError);
});

test("Ver por qué opens a Coach thread with the review, once", () => {
  const p = createProgram(input(), true, NOW - 30 * DAY);
  rhythm(NOW - DAY);
  const adjusted = setSessionAdjustment({ dayId: p.days[0]!.id, noChange: false, rationale: "Hoy más suave.", changes: [{ action: "adjust", programExerciseId: p.days[0]!.exercises[0]!.id, loadPercent: -10, sets: 3 }] }, NOW);
  const thread = adjustmentThreadId(adjusted.id, NOW);
  expect(adjustmentThreadId(adjusted.id, NOW)).toBe(thread);
  const [message] = listMessages(thread);
  expect(message?.text).toContain("Hoy más suave.");
  expect(message?.text).toContain("**Press de banca** — -10 % de peso · 3 series");
});

test("a session done moves on: its adjustment no longer applies to the next one", () => {
  const p = createProgram(input(), true, NOW - 30 * DAY);
  rhythm(NOW - DAY);
  setSessionAdjustment({ dayId: p.days[0]!.id, noChange: true, rationale: "Todo bien.", changes: [] }, NOW);
  expect(activeProgramView(NOW).adjustment).toMatchObject({ noChange: true });
  saveSession({ id: "after", dayId: p.days[0]!.id, name: "Torso A", startedAt: NOW, endedAt: NOW + 1000, sets: [] });
  expect(activeProgramView(NOW + 2000).adjustment).toBeNull();
});
