import { expect, test } from "bun:test";
import type { DietPlanInput, Macros, MealEntry, PlanMeal } from "@pulso/contract";
import { adjustDayPlan, describe as describeDay, mealsAhead, rebalance, roundQuantity, scaleItem } from "./adjust";
import { createPlan, eatPlanItem, logMeal, nutritionDay, planForDay, setTargets } from "./store";

const m = (kcal: number, protein = 0, carbs = 0, fat = 0): Macros => ({ kcal, protein, carbs, fat, fiber: 0 });
const item = (id: string, name: string, quantity: number, macros: Macros, unit: "g" | "serving" = "g") => ({ id, name, quantity, unit, ...macros });

// 2000 kcal day: 400 + 700 + 300 + 600.
const day: PlanMeal[] = [
  { slot: "desayuno", name: null, items: [item("d1", "Avena", 80, m(400, 15, 60, 8))] },
  { slot: "comida", name: "Pollo con arroz", items: [item("c1", "Pollo", 200, m(330, 62, 0, 7)), item("c2", "Arroz", 100, m(370, 7, 80, 1))] },
  { slot: "merienda", name: null, items: [item("m1", "Yogur", 2, m(300, 20, 30, 10), "serving")] },
  { slot: "cena", name: null, items: [item("n1", "Salmón", 200, m(600, 40, 0, 46))] },
];
const targets = m(2000, 144, 170, 72);
const entry = (slot: MealEntry["slot"]) => ({ slot }) as MealEntry;

test("meals ahead skip logged slots and anything before the last main meal", () => {
  expect(mealsAhead(day, []).map((x) => x.slot)).toEqual(["desayuno", "comida", "merienda", "cena"]);
  // Breakfast skipped, lunch eaten: only what comes after lunch is ahead.
  expect(mealsAhead(day, [entry("comida")]).map((x) => x.slot)).toEqual(["merienda", "cena"]);
  // A snack doesn't move the clock.
  expect(mealsAhead(day, [entry("desayuno"), entry("snack")]).map((x) => x.slot)).toEqual(["comida", "merienda", "cena"]);
  expect(mealsAhead(day, [entry("cena")])).toEqual([]);
});

test("portions round to 5 g or half servings and macros follow the rounded portion", () => {
  expect(roundQuantity(87, "g")).toBe(85);
  expect(roundQuantity(1, "g")).toBe(5);
  expect(roundQuantity(1.3, "serving")).toBe(1.5);
  expect(roundQuantity(0.1, "serving")).toBe(0.5);
  const salmon = scaleItem(item("n1", "Salmón", 200, m(600, 40, 0, 46)), 0.71);
  expect(salmon).toMatchObject({ id: "n1", quantity: 140, kcal: 420, protein: 28, fat: 32.2 });
});

test("under target: an off-plan light lunch grows the rest of the day, capped at 150 %", () => {
  // Ate 400 + a 200 kcal salad instead of the 700 kcal lunch: 1400 left for 900 planned.
  const r = rebalance(targets, m(600, 30), mealsAhead(day, [entry("desayuno"), entry("comida")]));
  expect(r.factor).toBe(1.5);
  expect(r.meals.map((x) => [x.slot, x.change])).toEqual([["merienda", "scaled"], ["cena", "scaled"]]);
  expect(r.meals[1]!.items[0]!.quantity).toBe(300);
  expect(r.projected.kcal).toBe(1950);
});

test("over target: a heavy off-plan lunch shrinks dinner, never below half", () => {
  // Big Mac + fries (1100 kcal) after breakfast: 500 left for 900 planned → 0.56.
  const r = rebalance(targets, m(1500, 50), mealsAhead(day, [entry("desayuno"), entry("comida")]));
  expect(r.factor).toBe(0.56);
  expect(r.projected.kcal).toBeLessThanOrEqual(2050);
  // Way over: clamped at 0.5 and the summary says by how much.
  const over = rebalance(targets, m(2200, 60), mealsAhead(day, [entry("comida")]));
  expect(over.factor).toBe(0.5);
  expect(describeDay(over, targets, m(2200, 60))).toContain("lo compensa la semana");
});

test("the last meal of the day takes the whole remainder", () => {
  const r = rebalance(targets, m(1700, 110), mealsAhead(day, [entry("desayuno"), entry("comida"), entry("merienda")]));
  expect(r.meals.map((x) => x.slot)).toEqual(["cena"]);
  expect(r.factor).toBe(0.5);
  expect(r.meals[0]!.items[0]!.quantity).toBe(100);
});

test("swaps count as given and the other meals scale around them", () => {
  const swap: PlanMeal = { slot: "cena", name: "Tortilla", items: [item("s1", "Tortilla de claras", 250, m(250, 40, 5, 6))] };
  const r = rebalance(targets, m(1500, 50), mealsAhead(day, [entry("comida")]), [swap]);
  expect(r.meals.map((x) => [x.slot, x.change])).toEqual([["merienda", "scaled"], ["cena", "swapped"]]);
  // 2000 − 1500 − 250 = 250 for a 300 kcal merienda.
  expect(r.factor).toBe(0.83);
  expect(describeDay(r, targets, m(1500, 50))).toStartWith("Merienda al 83 % y cena con cambios.");
});

test("nothing ahead: no meals and a summary of where the day stands", () => {
  const r = rebalance(targets, m(2300), []);
  expect(r.meals).toEqual([]);
  expect(describeDay(r, targets, m(2300))).toBe("No quedan comidas del plan hoy: llevas 2300 de 2000 kcal (+300).");
});

// --- Stored adjustments ---

const planInput: DietPlanInput = {
  name: "Definición",
  startsOn: "2034-01-01",
  days: [{ label: "Todos", meals: day.map(({ slot, name, items }) => ({ slot, name, items: items.map(({ id: _id, ...i }) => i) })) }],
};

test("adjusting stores the remaining meals over the plan without changing it", () => {
  const plan = createPlan(planInput);
  setTargets({ kcal: 2000, protein: 144, carbs: 170, fat: 72, fiber: 0 });
  logMeal({ name: "Avena", slot: "desayuno", quantity: 80, unit: "g", ...m(400, 15, 60, 8), date: "2034-01-05" });
  logMeal({ name: "Big Mac", slot: "comida", quantity: 1, unit: "serving", ...m(1100, 35, 110, 55), date: "2034-01-05", offPlan: true });

  const adjusted = adjustDayPlan("2034-01-05", { note: "Comida fuera del plan" });
  expect(adjusted.stored).toBe(true);
  expect(adjusted.meals.map((x) => x.slot)).toEqual(["merienda", "cena"]);
  expect(adjusted.factor).toBe(0.56);
  expect(adjusted.eaten.kcal).toBe(1500);
  expect(adjusted.summary).toContain("Merienda y cena al 56 %");

  const today = nutritionDay("2034-01-05");
  expect(today.plan?.adjustment?.note).toBe("Comida fuera del plan");
  expect(today.plan?.day.meals[3]?.items[0]?.quantity).toBe(200); // the plan is untouched
  expect(planForDay("2034-01-06")?.adjustment).toBeNull(); // other days too

  // Ticking a scaled item logs the adjusted portion.
  const dinner = adjusted.meals[1]!.items[0]!;
  expect(eatPlanItem(dinner.id, "2034-01-05")).toMatchObject({ quantity: dinner.quantity, kcal: dinner.kcal, planItemId: plan.days[0]!.meals[3]!.items[0]!.id });
  expect(nutritionDay("2034-01-05").plan?.eatenItemIds).toContain(dinner.id);
});

test("swaps survive a re-adjustment while their meal is still ahead", () => {
  createPlan(planInput);
  setTargets({ kcal: 2000, protein: 144, carbs: 170, fat: 72, fiber: 0 });
  logMeal({ name: "Pizza", slot: "comida", quantity: 1, unit: "serving", ...m(1200, 45, 140, 50), date: "2034-02-01", offPlan: true });
  const swap = { slot: "cena" as const, name: "Ligera", items: [{ name: "Merluza", quantity: 200, unit: "g" as const, ...m(180, 36, 0, 3) }] };
  adjustDayPlan("2034-02-01", { swaps: [swap] });
  logMeal({ name: "Yogur", slot: "merienda", quantity: 1, unit: "serving", ...m(150, 10, 15, 5), date: "2034-02-01" });
  const again = adjustDayPlan("2034-02-01");
  expect(again.meals).toHaveLength(1);
  expect(again.meals[0]).toMatchObject({ slot: "cena", change: "swapped", name: "Ligera" });
  expect(adjustDayPlan("2034-02-01", { resetSwaps: true }).meals[0]?.change).toBe("scaled");
});

test("with nothing left to adjust the stored adjustment is cleared", () => {
  createPlan(planInput);
  adjustDayPlan("2034-03-01");
  expect(planForDay("2034-03-01")?.adjustment).not.toBeNull();
  logMeal({ name: "Cena", slot: "cena", quantity: 1, unit: "serving", ...m(600), date: "2034-03-01" });
  expect(adjustDayPlan("2034-03-01").stored).toBe(false);
  expect(planForDay("2034-03-01")?.adjustment).toBeNull();
});
