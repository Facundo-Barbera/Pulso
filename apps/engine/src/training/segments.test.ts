import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { LiveExercise, LiveSession, SessionInput } from "@pulso/contract";
import { db } from "../db";
import { clearLive, describeLive, editLive, getLive, putLive, sessionFromLive } from "./live";
import { migrateTraining } from "./schema";
import { dropOffer, formatSet, formatSetShort, nextDrop, repsOf, segmentsOf, volumeOf } from "./segments";
import { exerciseHistory, exercisePerformance, getSession, saveSession, setExerciseUnit, suggestLoad, TrainingError } from "./store";
import { trainingTools } from "./tools";
import { fromUnit, shown } from "./units";

const DAY = 86_400_000;
const T0 = new Date(2026, 5, 1, 18).getTime();

const posted = (id: string, startedAt: number, sets: SessionInput["sets"]): SessionInput => ({ id, name: "Pecho", startedAt, endedAt: startedAt + 3_600_000, sets });

describe("segments of a set", () => {
  test("a plain set is one segment; the flat fields win over a stale segments[0]; empty drops go", () => {
    expect(segmentsOf({ weightKg: 80, reps: 5 })).toEqual([{ weightKg: 80, reps: 5 }]);
    const set = { weightKg: 80, reps: 5, segments: [{ weightKg: 70, reps: 9 }, { weightKg: 60, reps: 3 }, { weightKg: 50, reps: 0 }] };
    expect(segmentsOf(set)).toEqual([{ weightKg: 80, reps: 5 }, { weightKg: 60, reps: 3 }]);
    expect(volumeOf(set)).toBe(80 * 5 + 60 * 3);
    expect(repsOf(set)).toBe(8);
  });

  test("renders top first with an arrow, in the exercise's unit", () => {
    const set = { weightKg: 80, reps: 5, segments: [{ weightKg: 80, reps: 5 }, { weightKg: 60, reps: 3 }] };
    expect(formatSet(set, "kg")).toBe("80 kg × 5 → 60 kg × 3");
    expect(formatSetShort(set, "kg")).toBe("80 × 5 → 60 × 3");
    const lb = { weightKg: fromUnit(100, "lb"), reps: 6, segments: [{ weightKg: 0, reps: 0 }, { weightKg: fromUnit(85, "lb"), reps: 2 }] };
    expect(formatSet(lb, "lb")).toBe("100 lb × 6 → 85 lb × 2");
  });
});

describe("the contextual prompt", () => {
  test("offers only for a loaded set short of the bottom of the range, with no drop yet", () => {
    expect(dropOffer({ weightKg: 80, reps: 5 }, 8, "kg")).toEqual({ weightKg: 67.5, reps: 3 });
    expect(dropOffer({ weightKg: 80, reps: 8 }, 8, "kg")).toBeNull();
    expect(dropOffer({ weightKg: 80, reps: 10 }, 8, "kg")).toBeNull();
    expect(dropOffer({ weightKg: 0, reps: 4 }, 8, "kg")).toBeNull();
    expect(dropOffer({ weightKg: 80, reps: 0 }, 8, "kg")).toBeNull();
    expect(dropOffer({ weightKg: 80, reps: 5, segments: [{ weightKg: 80, reps: 5 }, { weightKg: 60, reps: 3 }] }, 8, "kg")).toBeNull();
  });

  test("the prefill is 10–20 % lighter on the unit's steps, for the reps missing", () => {
    for (const [unit, top] of [["kg", 20], ["kg", 32.5], ["kg", 80], ["kg", 140], ["lb", 45], ["lb", 100], ["lb", 225]] as const) {
      const kg = fromUnit(top, unit);
      const drop = nextDrop({ weightKg: kg, reps: 4 }, 10, unit);
      const cut = 1 - drop.weightKg / kg;
      expect(cut).toBeGreaterThanOrEqual(0.09);
      expect(cut).toBeLessThanOrEqual(0.21);
      // On the grid: a 5 lb or 2.5 kg plate step.
      expect(shown(drop.weightKg, unit) % (unit === "lb" ? 5 : 2.5)).toBe(0);
      expect(drop.reps).toBe(6);
    }
    expect(nextDrop({ weightKg: fromUnit(100, "lb"), reps: 4 }, 8, "lb")).toEqual({ weightKg: fromUnit(85, "lb"), reps: 4 });
    // A second drop goes from the last segment, for what is still missing.
    expect(nextDrop({ weightKg: 80, reps: 4, segments: [{ weightKg: 80, reps: 4 }, { weightKg: 67.5, reps: 2 }] }, 8, "kg")).toEqual({ weightKg: 57.5, reps: 2 });
    // Small dumbbells step by 1 kg; reps never under 1.
    expect(nextDrop({ weightKg: 10, reps: 9 }, 8, "kg")).toEqual({ weightKg: 9, reps: 1 });
  });
});

describe("saved sessions", () => {
  test("an old client's set is one segment; segments round-trip; volume sums them, records read the top", () => {
    saveSession(posted("seg-old", T0, [{ exerciseId: "contractor-pecho", setIndex: 0, weightKg: 40, reps: 8, rpe: null, doneAt: T0 + 1 }]));
    expect(getSession("seg-old")!.sets[0]!.segments).toEqual([{ weightKg: 40, reps: 8 }]);

    const top = { weightKg: 62.5, reps: 1 };
    const saved = saveSession(
      posted("seg-new", T0 + DAY, [{ exerciseId: "contractor-pecho", setIndex: 0, ...top, rpe: null, doneAt: T0 + DAY + 1, segments: [top, { weightKg: 50, reps: 10 }] }]),
    );
    expect(saved.session.sets[0]!.segments).toEqual([top, { weightKg: 50, reps: 10 }]);
    // e1RM and heaviest load from the 62,5 kg single only: the 50 × 10 drop (e1RM 66,7) is not a record.
    expect(saved.prs.map((p) => [p.kind, p.value])).toEqual([["e1rm", 62.5], ["weight", 62.5]]);

    const point = exerciseHistory("contractor-pecho")!.points.at(-1)!;
    expect(point).toMatchObject({ topWeightKg: 62.5, bestE1rm: 62.5, totalReps: 11, volumeKg: 62.5 + 50 * 10 });
    expect(exercisePerformance("contractor-pecho")!.history.at(-1)!.volumeKg).toBe(562.5);
    // Progression reads 1 rep at 62,5 kg: short of 8, it backs off; the drop doesn't hide that.
    expect(suggestLoad("contractor-pecho", { sets: 1, repMin: 8, repMax: 12 }).weightKg).toBeLessThan(62.5);
  });

  test("a pound drop is stored as its exact kg and reads the same pounds again", () => {
    setExerciseUnit("aperturas-mancuernas", "lb");
    const top = { weightKg: fromUnit(45, "lb"), reps: 6 };
    saveSession(posted("seg-lb", T0 + 2 * DAY, [{ exerciseId: "aperturas-mancuernas", setIndex: 0, ...top, rpe: null, doneAt: T0 + 2 * DAY, segments: [top, { weightKg: fromUnit(35, "lb"), reps: 4 }] }]));
    const set = getSession("seg-lb")!.sets[0]!;
    expect(set.segments!.map((s) => shown(s.weightKg, "lb"))).toEqual([45, 35]);
    expect(formatSet(set, "lb")).toBe("45 lb × 6 → 35 lb × 4");
    setExerciseUnit("aperturas-mancuernas", null);
  });

  test("the migration adds the column once and earlier sets read as one segment", () => {
    saveSession(posted("seg-migrate", T0 + 3 * DAY, [{ exerciseId: "pullover-polea", setIndex: 0, weightKg: 30, reps: 12, rpe: null, doneAt: T0 + 3 * DAY }]));
    db().exec("ALTER TABLE set_logs DROP COLUMN drops");
    migrateTraining(db());
    migrateTraining(db());
    expect(getSession("seg-migrate")!.sets[0]!.segments).toEqual([{ weightKg: 30, reps: 12 }]);
  });
});

describe("the session in progress", () => {
  const exercise = (sets: LiveExercise["sets"]): LiveExercise => ({
    id: "enc",
    exerciseId: "encogimientos",
    name: "Encogimientos con mancuernas",
    equipment: "dumbbell",
    kind: "isolation",
    repMin: 8,
    repMax: 12,
    targetRpe: null,
    targetRir: null,
    restSeconds: 90,
    notes: null,
    hint: null,
    sets,
    cardio: null,
    cardioLog: null,
    skipped: false,
    supersetId: null,
  });
  const live = (sets: LiveExercise["sets"]): LiveSession => ({
    id: "seg-live",
    programId: null,
    dayId: null,
    name: "Espalda",
    startedAt: T0,
    exercises: [exercise(sets)],
    focus: 0,
    restStartedAt: null,
    restEndsAt: null,
    version: 0,
    updatedAt: 0,
    threadId: null,
  });

  beforeEach(() => clearLive());
  afterAll(() => clearLive());

  test("the phone's sets keep their segments; an old phone's sets get one", () => {
    putLive(live([{ id: "s1", weightKg: 30, reps: 5, rpe: null, doneAt: T0, segments: [{ weightKg: 30, reps: 5 }, { weightKg: 24, reps: 3 }] }, { id: "s2", weightKg: 30, reps: 8, rpe: null, doneAt: null }]), 0, T0);
    const sets = getLive()!.exercises[0]!.sets;
    expect(sets.map((s) => s.segments)).toEqual([[{ weightKg: 30, reps: 5 }, { weightKg: 24, reps: 3 }], [{ weightKg: 30, reps: 8 }]]);
    expect(sessionFromLive(getLive()!, T0 + 1).sets[0]!.segments).toEqual([{ weightKg: 30, reps: 5 }, { weightKg: 24, reps: 3 }]);
  });

  test('"bajé a 24 para terminar 3 más" adds a segment to the set done last', async () => {
    putLive(live([{ id: "s1", weightKg: 30, reps: 9, rpe: null, doneAt: T0 }, { id: "s2", weightKg: 30, reps: 5, rpe: null, doneAt: T0 + 60_000 }, { id: "s3", weightKg: 30, reps: 8, rpe: null, doneAt: null }]), 0, T0);
    const edit = trainingTools.find((t) => t.name === "edit_live_session")!;
    const result = await edit.handler({ ops: [{ op: "drop", weightKg: 24, reps: 3 }] } as never, undefined);
    expect(result.isError).toBeFalsy();
    const sets = getLive()!.exercises[0]!.sets;
    expect(sets[1]!.segments).toEqual([{ weightKg: 30, reps: 5 }, { weightKg: 24, reps: 3 }]);
    expect(sets[0]!.segments).toHaveLength(1);
    expect(describeLive(getLive()!)).toContain("serie 2: 30 kg × 5 → 24 kg × 3");

    // A set of its own, by number; a set not done yet is refused.
    expect(editLive([{ op: "drop", exercise: 1, set: 1, weightKg: 25, reps: 2 }]).changes).toEqual(["Encogimientos con mancuernas: 30 kg × 9 → 25 kg × 2"]);
    expect(() => editLive([{ op: "drop", exercise: 1, set: 3, weightKg: 25, reps: 2 }])).toThrow(TrainingError);
  });

  test("a drop on a pound machine lands on its steps", () => {
    setExerciseUnit("encogimientos", "lb");
    putLive(live([{ id: "s1", weightKg: fromUnit(70, "lb"), reps: 6, rpe: null, doneAt: T0 }]), 0, T0);
    editLive([{ op: "drop", weightKg: 27, reps: 2 }]); // 59,5 lb → 60 lb
    expect(shown(getLive()!.exercises[0]!.sets[0]!.segments![1]!.weightKg, "lb")).toBe(60);
    setExerciseUnit("encogimientos", null);
  });

  test("with nothing done there is nothing to drop", () => {
    putLive(live([{ id: "s1", weightKg: 30, reps: 8, rpe: null, doneAt: null }]), 0, T0);
    expect(() => editLive([{ op: "drop", weightKg: 24, reps: 3 }])).toThrow(TrainingError);
  });
});
