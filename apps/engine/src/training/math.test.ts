import { describe, expect, test } from "bun:test";
import { bests, e1rm, nextLoad, recordsFor } from "./math";

describe("e1rm (Epley)", () => {
  test("estimates from weight and reps", () => {
    expect(e1rm(100, 5)).toBe(116.7);
    expect(e1rm(80, 10)).toBe(106.7);
  });
  test("a single is its own 1RM; no load or reps estimates nothing", () => {
    expect(e1rm(140, 1)).toBe(140);
    expect(e1rm(0, 12)).toBe(0);
    expect(e1rm(100, 0)).toBe(0);
  });
});

test("bests track e1RM, heaviest load and bodyweight reps", () => {
  expect(bests([{ weightKg: 100, reps: 5 }, { weightKg: 110, reps: 1 }, { weightKg: 0, reps: 15 }])).toEqual({ e1rm: 116.7, weight: 110, reps: 15 });
});

describe("recordsFor", () => {
  const press = { id: "press-banca", name: "Press de banca" };

  test("a first session sets no records", () => {
    expect(recordsFor(press, [{ weightKg: 100, reps: 5 }], [])).toEqual([]);
  });

  test("beating the e1RM and the heaviest load reports both, with the previous value", () => {
    const records = recordsFor(press, [{ weightKg: 105, reps: 5 }], [{ weightKg: 100, reps: 5 }]);
    expect(records.map((r) => [r.kind, r.value, r.previous])).toEqual([
      ["e1rm", 122.5, 116.7],
      ["weight", 105, 100],
    ]);
  });

  test("more reps at the same load is an e1RM record but not a weight record", () => {
    const records = recordsFor(press, [{ weightKg: 100, reps: 7 }], [{ weightKg: 100, reps: 5 }]);
    expect(records.map((r) => r.kind)).toEqual(["e1rm"]);
  });

  test("bodyweight sets record reps", () => {
    const records = recordsFor({ id: "dominadas", name: "Dominadas" }, [{ weightKg: 0, reps: 12 }], [{ weightKg: 0, reps: 10 }]);
    expect(records).toEqual([{ exerciseId: "dominadas", exerciseName: "Dominadas", kind: "reps", value: 12, previous: 10 }]);
  });

  test("matching the best is not a record", () => {
    expect(recordsFor(press, [{ weightKg: 100, reps: 5 }], [{ weightKg: 100, reps: 5 }])).toEqual([]);
  });
});

describe("nextLoad (double progression)", () => {
  const rx = { sets: 3, repMin: 6, repMax: 10 };
  const last = (sets: [number, number][]) => ({ at: 1_000, sets: sets.map(([weightKg, reps]) => ({ weightKg, reps })) });

  test("no history: no load, bottom of the range", () => {
    expect(nextLoad("x", rx, null, 2.5)).toMatchObject({ weightKg: null, reps: 6, lastSessionAt: null });
  });

  test("every set at the top of the range adds one increment", () => {
    expect(nextLoad("x", rx, last([[60, 10], [60, 10], [60, 11]]), 2.5)).toMatchObject({ weightKg: 62.5, reps: 6, lastSessionAt: 1_000 });
  });

  test("fewer sets than prescribed at the top weight does not progress", () => {
    expect(nextLoad("x", rx, last([[60, 10], [60, 10]]), 2.5)).toMatchObject({ weightKg: 60, reps: 10 });
  });

  test("inside the range: same load, one more rep than the worst set", () => {
    expect(nextLoad("x", rx, last([[60, 9], [60, 8], [60, 7]]), 2.5)).toMatchObject({ weightKg: 60, reps: 8 });
  });

  test("only sets at the top weight count", () => {
    expect(nextLoad("x", rx, last([[40, 4], [60, 10], [60, 10], [60, 10]]), 2.5)).toMatchObject({ weightKg: 62.5 });
  });

  test("short of the bottom backs off one increment", () => {
    expect(nextLoad("x", rx, last([[60, 5], [60, 4], [60, 4]]), 2.5)).toMatchObject({ weightKg: 57.5, reps: 6 });
  });

  test("bodyweight at the top adds a rep instead of load", () => {
    expect(nextLoad("dominadas", rx, last([[0, 10], [0, 10], [0, 10]]), 0)).toMatchObject({ weightKg: 0, reps: 11 });
  });
});
