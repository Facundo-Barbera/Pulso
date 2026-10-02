import { expect, test } from "bun:test";
import type { MealInput } from "@pulso/contract";
import { createPlan, listMeals, logMeal, saveAdjustment, setTargets } from "../nutrition/store";
import { logWater } from "../nutrition/water";
import { dietaDay, dietaProgress, eatPlanItems, moments, replaceMeal } from "./dieta";

// The DB is shared across test files in this process, so these use their own dates (2031).
const at = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, m).getTime();
};
const food = (name: string, slot: MealInput["slot"], kcal: number, extra: Partial<MealInput> = {}): MealInput => ({
  name, slot, quantity: 100, unit: "g", kcal, protein: 10, carbs: 10, fat: 5, fiber: 1, ...extra,
});

test("moments group a slot together and split snacks more than 45 minutes apart; drink-only snacks read as Bebida", () => {
  const d = "2031-01-10";
  const entries = [
    logMeal(food("Avena", "desayuno", 300, { eatenAt: at(d, 8) })),
    logMeal(food("Café", "snack", 5, { eatenAt: at(d, 10), unit: "ml", quantity: 60 })),
    logMeal(food("Galleta", "snack", 80, { eatenAt: at(d, 10, 30) })),
    logMeal(food("Cerveza", "snack", 140, { eatenAt: at(d, 21), unit: "ml", quantity: 330 })),
    logMeal(food("Plátano", "desayuno", 90, { eatenAt: at(d, 8, 10) })),
  ];
  const result = moments(entries);
  expect(result.map((m) => [m.title, m.entries.length])).toEqual([["Desayuno", 2], ["Snack", 2], ["Bebida", 1]]);
  expect(result[0]!.kcal).toBe(390);
  expect(result[0]!.time).toBe("08:00");
});

test("the day carries the plan with the adjustment laid over it, eaten marks and the next meal", () => {
  const d = "2031-02-01";
  setTargets({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
  const plan = createPlan({
    name: "Definición",
    startsOn: d,
    days: [
      {
        label: "Entreno",
        meals: [
          { slot: "desayuno", items: [{ name: "Avena", quantity: 60, unit: "g", kcal: 230, protein: 8, carbs: 40, fat: 4, fiber: 6 }] },
          { slot: "comida", name: "Pollo con arroz", items: [{ name: "Pollo", quantity: 150, unit: "g", kcal: 250, protein: 46, carbs: 0, fat: 5, fiber: 0 }, { name: "Arroz", quantity: 80, unit: "g", kcal: 280, protein: 6, carbs: 62, fat: 1, fiber: 1 }] },
          { slot: "cena", items: [{ name: "Salmón", quantity: 150, unit: "g", kcal: 300, protein: 30, carbs: 0, fat: 20, fiber: 0 }] },
        ],
      },
      { label: "Descanso", meals: [{ slot: "comida", items: [{ name: "Lentejas", quantity: 200, unit: "g", kcal: 230, protein: 18, carbs: 40, fat: 1, fiber: 8 }] }] },
    ],
  });
  const [breakfast, lunch, dinner] = plan.days[0]!.meals;
  saveAdjustment({
    date: d, planId: plan.id, dayIndex: 0, factor: 0.8, eaten: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, targets: { kcal: 2000, protein: 150, carbs: 200, fat: 60, fiber: 28 },
    projected: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, summary: "Cena al 80 %.", note: null, createdAt: Date.now(),
    meals: [{ slot: "cena", name: null, change: "scaled", items: [{ ...dinner!.items[0]!, quantity: 120, kcal: 240 }] }],
  });

  const eaten = eatPlanItems([breakfast!.items[0]!.id, "not-a-plan-item"], d);
  expect(eaten).toHaveLength(1);
  // Eating it again is a no-op.
  expect(eatPlanItems([breakfast!.items[0]!.id], d)).toHaveLength(0);

  const day = dietaDay(d, d);
  expect(day.plan?.dayLabel).toBe("Entreno");
  expect(day.plan?.meals.map((m) => [m.slot, m.kcal, m.change, m.done])).toEqual([
    ["desayuno", 230, null, true],
    ["comida", 530, null, false],
    ["cena", 240, "scaled", false],
  ]);
  expect(day.plan?.meals[0]!.items[0]!.entryId).toBe(eaten[0]!.id);
  expect([day.plan?.eaten, day.plan?.total]).toEqual([1, 4]);
  expect(day.plan?.adjustment?.summary).toBe("Cena al 80 %.");
  expect(day.plan?.days.map((x) => [x.label, x.kcal])).toEqual([["Entreno", 1060],["Descanso", 230]]);
  expect(day.next?.slot).toBe(lunch!.slot);
  expect(day.moments.map((m) => m.title)).toEqual(["Desayuno"]);
  expect(day.summary.remaining?.kcal).toBe(1770);

  // The next day is the plan's second day.
  expect(dietaDay("2031-02-02", d).plan?.dayLabel).toBe("Descanso");
});

test("replacing an entry keeps where it came from and changes what was corrected", () => {
  const d = "2031-03-01";
  const original = logMeal(food("Yogur", "merienda", 120, { date: d, eatenAt: at(d, 17), offPlan: true, note: "Del súper" }), "barcode");
  const updated = replaceMeal(original.id, food("Yogur griego", "snack", 150, { date: d, eatenAt: at(d, 18), quantity: 125 }))!;
  expect(updated.name).toBe("Yogur griego");
  expect([updated.slot, updated.kcal, updated.quantity, updated.source, updated.note]).toEqual(["snack", 150, 125, "barcode", "Del súper"]);
  expect(listMeals(d).map((m) => m.id)).toEqual([updated.id]);
  expect(replaceMeal("missing", food("X", "snack", 1))).toBeUndefined();
});

test("progress has one row per day with kcal, water, days in zone and plan share", () => {
  const today = "2031-04-14";
  setTargets({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
  logMeal(food("Comida", "comida", 1950, { date: "2031-04-13", protein: 160 }));
  logMeal(food("Comida", "comida", 1000, { date: "2031-04-12", protein: 160 }));
  logMeal(food("Comida", "comida", 2000, { date: "2031-04-11", protein: 90 })); // kcal in zone, protein short of its minimum
  logWater({ amountMl: 1500, date: "2031-04-13" });
  const progress = dietaProgress(today, 7);
  expect(progress.days).toHaveLength(7);
  expect(progress.days.at(-1)!.date).toBe(today);
  const byDate = Object.fromEntries(progress.days.map((d) => [d.date, d]));
  expect(byDate["2031-04-13"]).toMatchObject({ kcal: 1950, waterMl: 1500, onTarget: true });
  expect(byDate["2031-04-12"]!.onTarget).toBe(false);
  expect(byDate["2031-04-11"]!.onTarget).toBe(false);
  expect(progress.averages).toMatchObject({ kcal: 1650, onTarget: 1, logged: 3, waterMl: 1500 });
});
