import { expect, test } from "bun:test";
import type { DietPlanInput, MealInput } from "@pulso/contract";
import {
  activePlan,
  addDays,
  copyDay,
  createPlan,
  dailySummary,
  deleteMeal,
  eatPlanItem,
  frequentFoods,
  listMeals,
  localDate,
  logMeal,
  nutritionDay,
  planDayIndex,
  setTargets,
  summaries,
} from "./store";

// The DB is shared across tests in this process, so each test uses its own dates.
const oats: MealInput = { name: "Avena", slot: "desayuno", quantity: 60, unit: "g", kcal: 228, protein: 8.1, carbs: 39.6, fat: 4.2, fiber: 6 };
const chicken: MealInput = { name: "Pollo", slot: "comida", quantity: 150, unit: "g", kcal: 247.5, protein: 46.5, carbs: 0, fat: 5.4, fiber: 0 };

const plan = (overrides: Partial<DietPlanInput> = {}): DietPlanInput => ({
  name: "Plan",
  startsOn: "2030-01-01",
  days: [
    { label: "A", meals: [{ slot: "desayuno", items: [{ name: "Avena", quantity: 60, unit: "g", kcal: 228, protein: 8, carbs: 40, fat: 4, fiber: 6 }] }] },
    { label: "B", meals: [{ slot: "comida", name: "Pollo con arroz", items: [{ name: "Pollo", quantity: 150, unit: "g", kcal: 250, protein: 46, carbs: 0, fat: 5, fiber: 0 }] }] },
  ],
  ...overrides,
});

test("logMeal defaults date from eatenAt and source to manual", () => {
  const eatenAt = new Date(2029, 0, 5, 8, 30).getTime();
  const entry = logMeal({ ...oats, eatenAt });
  expect(entry.date).toBe("2029-01-05");
  expect(entry.source).toBe("manual");
  expect(listMeals("2029-01-05").map((m) => m.id)).toEqual([entry.id]);
  expect(deleteMeal(entry.id)).toBe(true);
  expect(deleteMeal(entry.id)).toBe(false);
  expect(listMeals("2029-01-05")).toHaveLength(0);
});

test("daily summary adds totals, splits by slot and subtracts from targets", () => {
  setTargets({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
  logMeal({ ...oats, date: "2029-02-01" });
  logMeal({ ...oats, date: "2029-02-01" });
  logMeal({ ...chicken, date: "2029-02-01" });
  logMeal({ ...chicken, date: "2029-02-02" });
  const s = dailySummary("2029-02-01");
  expect(s.entries).toBe(3);
  expect(s.totals).toEqual({ kcal: 703.5, protein: 62.7, carbs: 79.2, fat: 13.8, fiber: 12 });
  expect(s.bySlot.desayuno?.kcal).toBe(456);
  expect(s.bySlot.cena).toBeUndefined();
  expect(s.targets?.fiber).toBe(28); // 14 g per 1000 kcal by default
  expect(s.remaining).toEqual({ kcal: 1296.5, protein: 87.3, carbs: 120.8, fat: 46.2, fiber: 16 });
});

test("summaries include empty days in the range", () => {
  logMeal({ ...oats, date: "2029-03-02" });
  const days = summaries("2029-03-01", "2029-03-03");
  expect(days.map((d) => [d.date, d.entries])).toEqual([["2029-03-01", 0], ["2029-03-02", 1], ["2029-03-03", 0]]);
});

test("copyDay moves entries and their times onto the target day", () => {
  const eatenAt = new Date(2029, 3, 10, 13, 0).getTime();
  logMeal({ ...chicken, eatenAt });
  const copied = copyDay("2029-04-10", "2029-04-11");
  expect(copied).toHaveLength(1);
  expect(copied[0]?.date).toBe("2029-04-11");
  expect(localDate(copied[0]!.eatenAt)).toBe("2029-04-11");
  expect(listMeals("2029-04-10")).toHaveLength(1);
});

test("creating an active plan assigns item ids and replaces the previous active plan", () => {
  const first = createPlan(plan({ name: "Primero" }));
  const second = createPlan(plan({ name: "Segundo" }));
  const draft = createPlan(plan({ name: "Borrador", activate: false }));
  expect(activePlan()?.id).toBe(second.id);
  expect(first.id).not.toBe(second.id);
  expect(draft.active).toBe(false);
  const ids = second.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.id)));
  expect(new Set(ids).size).toBe(2);
  expect(second.days[1]?.meals[0]?.name).toBe("Pollo con arroz");
  expect(second.days[0]?.meals[0]?.name).toBeNull();
});

test("plan days cycle from startsOn, also before it", () => {
  const p = { startsOn: "2030-01-01", days: [{ label: "A", meals: [] }, { label: "B", meals: [] }, { label: "C", meals: [] }] };
  expect(planDayIndex(p, "2030-01-01")).toBe(0);
  expect(planDayIndex(p, "2030-01-05")).toBe(1);
  expect(planDayIndex(p, "2029-12-31")).toBe(2);
});

test("eating a plan item logs it as source plan and marks it eaten on that day", () => {
  const p = createPlan(plan());
  const item = p.days[1]!.meals[0]!.items[0]!;
  const meal = eatPlanItem(item.id, "2030-01-02");
  expect(meal).toMatchObject({ name: "Pollo", slot: "comida", source: "plan", planItemId: item.id, kcal: 250, date: "2030-01-02" });
  const day = nutritionDay("2030-01-02");
  expect(day.plan?.day.label).toBe("B");
  expect(day.plan?.eatenItemIds).toEqual([item.id]);
  expect(day.summary.totals.kcal).toBe(250);
  expect(eatPlanItem("not-an-item")).toBeUndefined();
});

test("frequent foods rank by count and keep the latest portion", () => {
  const today = "2031-06-30";
  logMeal({ ...oats, name: "Yogur", quantity: 125, date: "2031-06-20", eatenAt: 1 });
  logMeal({ ...oats, name: "yogur", quantity: 200, date: "2031-06-21", eatenAt: 2 });
  logMeal({ ...oats, name: "Manzana", date: "2031-06-22", eatenAt: 3 });
  const foods = frequentFoods(2, today);
  expect(foods[0]).toMatchObject({ name: "yogur", quantity: 200, count: 2 });
  expect(foods[1]?.name).toBe("Manzana");
});

test("addDays crosses months and years", () => {
  expect(addDays("2029-12-31", 1)).toBe("2030-01-01");
  expect(addDays("2029-03-01", -1)).toBe("2029-02-28");
});
