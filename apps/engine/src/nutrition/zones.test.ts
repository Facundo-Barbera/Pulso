import { expect, test } from "bun:test";
import type { MealInput } from "@pulso/contract";
import { setGoal, upsertSamples } from "../body/store";
import { dailySummary, logMeal, setTargets } from "./store";
import { bodyDirection, customZone, derivedZone, statusOf } from "./zones";

// The DB is shared across tests in this process, so each test uses its own dates.
const food = (kcal: number, protein: number, extra: Partial<MealInput> = {}): MealInput => ({
  name: "Comida", slot: "comida", quantity: 100, unit: "g", kcal, protein, carbs: 100, fat: 30, fiber: 10, ...extra,
});

test("derived zones: kcal a band around the target that leans on the goal, protein and fiber a minimum", () => {
  expect(derivedZone("kcal", 2000, "maintain")).toEqual({ kind: "range", min: 1900, max: 2100, custom: false });
  expect(derivedZone("kcal", 2000, "loss")).toEqual({ kind: "range", min: 1800, max: 2100, custom: false });
  expect(derivedZone("kcal", 2000, "gain")).toEqual({ kind: "range", min: 1900, max: 2200, custom: false });
  expect(derivedZone("protein", 160, "loss")).toEqual({ kind: "min", min: 160, max: 200, custom: false });
  expect(derivedZone("carbs", 200, "loss")).toEqual({ kind: "range", min: 160, max: 220, custom: false });
  expect(derivedZone("fat", 60, "loss")).toEqual({ kind: "range", min: 48, max: 66, custom: false });
  expect(derivedZone("fiber", 28, "loss")).toEqual({ kind: "min", min: 28, max: 35, custom: false });
});

test("custom zones take their kind from the bounds given and fill the rest", () => {
  expect(customZone("protein", 160, { min: 150 }, "loss")).toEqual({ kind: "min", min: 150, max: 188, custom: true });
  expect(customZone("kcal", 2000, { min: 1850, max: 2050 }, "loss")).toEqual({ kind: "range", min: 1850, max: 2050, custom: true });
  expect(customZone("fat", 60, { max: 70 }, "loss")).toEqual({ kind: "max", min: null, max: 70, custom: true });
  expect(customZone("carbs", 200, { kind: "range", max: 240 }, "maintain")).toEqual({ kind: "range", min: 160, max: 240, custom: true });
});

test("status: below the minimum, in the zone, above the max (never above for a minimum)", () => {
  const kcal = derivedZone("kcal", 2000, "loss");
  expect(statusOf(1700, kcal)).toBe("below");
  expect(statusOf(1800, kcal)).toBe("inZone");
  expect(statusOf(2100, kcal)).toBe("inZone");
  expect(statusOf(2101, kcal)).toBe("above");
  const protein = derivedZone("protein", 160, "loss");
  expect(statusOf(120, protein)).toBe("below");
  expect(statusOf(400, protein)).toBe("inZone");
  expect(statusOf(0, { kind: "max", min: null, max: 70, custom: true })).toBe("inZone");
});

test("the daily summary reads each nutrient against its zone and counts the day in zone", () => {
  setTargets({ kcal: 2000, protein: 160, carbs: 200, fat: 60, zones: { protein: { min: 150 } } });
  const d = "2034-05-01";
  logMeal(food(1950, 155, { date: d }));
  const s = dailySummary(d);
  expect(s.targets?.zones.protein).toEqual({ kind: "min", min: 150, max: 188, custom: true });
  expect(s.zones?.protein).toMatchObject({ value: 155, target: 160, min: 150, status: "inZone" });
  expect(s.zones?.carbs).toMatchObject({ value: 100, status: "below" });
  expect(s.zones?.kcal.status).toBe("inZone");
  expect(s.inZone).toBe(true);

  logMeal(food(300, 0, { date: d }));
  expect(dailySummary(d).zones?.kcal.status).toBe("above");
  expect(dailySummary(d).inZone).toBe(false);
  expect(dailySummary("2034-05-02").inZone).toBe(false); // nothing logged

  // Setting targets again without zones derives them again.
  expect(setTargets({ kcal: 2000, protein: 160, carbs: 200, fat: 60 }).zones.protein.custom).toBe(false);
});

test("a body goal below the latest reading means fat loss: the kcal floor drops to −10 %", () => {
  expect(bodyDirection()).toBe("maintain");
  upsertSamples([{ externalId: "zones-weight", metric: "weight", value: 82, measuredAt: Date.UTC(2034, 0, 1) }]);
  setGoal("weight", 76);
  try {
    expect(bodyDirection()).toBe("loss");
    expect(setTargets({ kcal: 2000, protein: 160, carbs: 200, fat: 60 }).zones.kcal).toMatchObject({ min: 1800, max: 2100 });
    setGoal("weight", 88);
    expect(bodyDirection()).toBe("gain");
  } finally {
    setGoal("weight", null);
  }
});
