import { beforeEach, expect, test } from "bun:test";
import type { MealInput } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { eatSlot, replaceMeal } from "../web/dieta";
import { ownDatabase } from "../web/test-db";
import { backfillDishes } from "./dish-backfill";
import { dishName, dishPortion, listSavedDishes, saveDish } from "./dishes";
import { dietDay } from "./horizon";
import { addToDish, logDish, logSavedDish, saveLoggedDish, saveRecipeAsDish } from "./logged-dishes";
import { createRecipe } from "./recipes";
import { slotRows } from "./slots";
import { activePlan, copyDay, createPlan, dailySummary, deleteMeal, listMeals, logMeals, setTargets } from "./store";
import { nutritionTools } from "./tools";

ownDatabase("dishes");

const D = "2034-05-10";
const at = (h: number, m = 0, date = D) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, m).getTime();
};
const food = (name: string, kcal: number, extra: Partial<MealInput> = {}): MealInput => ({
  name, slot: "comida", quantity: 100, unit: "g", kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 50, fiber: 0, date: D, ...extra,
});

async function call(name: string, args: unknown) {
  const t = nutritionTools.find((x) => x.name === name)!;
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const text = (result.content[0] as { text: string }).text;
  return { error: result.isError === true, text, value: result.isError ? undefined : JSON.parse(text) };
}

beforeEach(() => {
  db().exec(`DELETE FROM diet_plans; DELETE FROM plan_slots; DELETE FROM plan_days; DELETE FROM plan_revisions; DELETE FROM meal_entries;
    DELETE FROM meal_slot_links; DELETE FROM meal_dishes; DELETE FROM saved_dishes; DELETE FROM recipes; DELETE FROM nutrition_targets;`);
});

// The person's lunch and shake as they were logged before dishes existed.
const lunch = () => [food("Queso amarillo", 130), food("Arroz blanco cocido", 210), food("Tortitas de carne de res 90/10 (air fryer)", 430)];
const whey = () => food("Proteína whey (1 scoop 25 g) con leche Lala 100 +Proteína Light (500 ml)", 320, { slot: "snack", unit: "ml", quantity: 500 });
const strawberries = () => food("Fresas (5 medianas, en el batido)", 27, { slot: "snack", quantity: 60 });

test("names foods eaten together: the main food with the rest, a shake as a shake", () => {
  expect(dishName(lunch())).toBe("Tortitas de carne con queso y arroz");
  expect(dishName([whey(), strawberries()])).toBe("Batido de proteína con fresas");
  expect(dishName([food("Avena", 300)])).toBe("Avena");
});

test("log_meal logs foods eaten together as one dish whose total is its components'", async () => {
  const logged = await call("log_meal", { items: lunch().map(({ date: _d, ...f }) => f), at: "14:30", date: D, dish: "Tortitas de carne con queso y arroz" });
  expect(logged.error).toBe(false);
  const entries = logged.value as { dish: { id: string; name: string }; eatenAt: number }[];
  expect(entries).toHaveLength(3);
  expect(new Set(entries.map((e) => e.dish.id)).size).toBe(1);
  expect(entries[0]!.dish.name).toBe("Tortitas de carne con queso y arroz");
  expect(dailySummary(D).totals.kcal).toBe(770);
  // Components keep their order.
  expect(listMeals(D).map((e) => e.name)).toEqual(lunch().map((f) => f.name));

  // Without a name, several foods of one meal are still one dish.
  const shake = await call("log_meal", { items: [whey(), strawberries()].map(({ date: _d, ...f }) => f), at: "10:00", date: D });
  expect(shake.value[0].dish.name).toBe("Batido de proteína con fresas");
});

test("a food logged on its own reads as before, without a dish", () => {
  const [single] = logMeals([food("Manzana", 80, { slot: "snack" })]);
  expect(single!.dish).toBeNull();
  expect(listMeals(D)[0]!.dish).toBeNull();
});

test("save a logged dish, then log it scaled and with one-off changes", () => {
  const eaten = logDish([whey(), strawberries()], "Batido de proteína", { eatenAt: at(10), date: D, slot: "snack" });
  const saved = saveLoggedDish(eaten[0]!.dish!.id);
  expect(saved.name).toBe("Batido de proteína");
  expect(saved.slot).toBeNull(); // a snack varies
  expect(saved.macros.kcal).toBe(347);
  expect(saved.uses).toBe(1);

  const half = logSavedDish(saved.id, { scale: 0.5 }, { eatenAt: at(18), date: D });
  expect(half.reduce((s, e) => s + e.kcal, 0)).toBe(173.5);
  expect(half[0]!.dish!.savedDishId).toBe(saved.id);

  // «Hoy con 300 ml de leche»: the shake's 500 ml become 300, its macros follow.
  const less = logSavedDish(saved.id, { overrides: [{ component: "proteina whey", measure: "300 ml" }] }, { eatenAt: at(19), date: D, slot: "merienda" });
  expect(less[0]!.quantity).toBe(300);
  expect(less[0]!.kcal).toBe(192);
  expect(less[0]!.slot).toBe("merienda");
  expect(listSavedDishes()[0]!.uses).toBe(3);
  expect(listSavedDishes()[0]!.components[0]!.quantity).toBe(500); // the saved dish didn't change

  expect(dishPortion(saved.components, { overrides: [{ component: 1, remove: true }] })).toHaveLength(1);
  expect(() => dishPortion(saved.components, { overrides: [{ component: 0, measure: "30 g" }] })).toThrow(/counted in ml/);
  expect(() => dishPortion(saved.components, { overrides: [{ component: "pizza", measure: "30 g" }] })).toThrow(/No components match/);
});

test("the Coach saves, finds and logs a dish by name", async () => {
  const saved = await call("save_dish", {
    name: "Batido de proteína",
    components: [
      { name: "Proteína whey", measure: "25 g", kcal: 100, protein: 20, carbs: 3, fat: 1.5 },
      { name: "Leche Lala 100 Proteína Light", measure: "500 ml", kcal: 220, protein: 30, carbs: 25, fat: 5 },
    ],
  });
  expect(saved.value.macros.kcal).toBe(320);
  const logged = await call("log_dish", { name: "batido", scale: 1.5, at: "09:00", date: D });
  expect(logged.value).toHaveLength(2);
  expect(logged.value[0].quantity).toBe(37.5);
  expect(logged.value[0].measure).toEqual({ amount: 37.5, unit: "g", size: null });
  expect((await call("log_dish", { name: "lasaña" })).error).toBe(true);
  const renamed = await call("update_dish", { id: saved.value.id, newName: "Batido de la mañana", slot: "desayuno" });
  expect(renamed.value.slot).toBe("desayuno");
  expect((await call("list_dishes", {})).value[0].uses).toBe(1);
});

test("adding to, editing and deleting a logged dish's components", () => {
  const [first] = logDish([whey()], "Batido de proteína", { eatenAt: at(10), date: D, slot: "snack" });
  const dish = first!.dish!.id;
  const grown = addToDish(dish, [strawberries()]);
  expect(grown.map((e) => e.name)).toEqual([whey().name, strawberries().name]);
  expect(grown[1]!.eatenAt).toBe(at(10));

  const fixed = replaceMeal(grown[0]!.id, { ...whey(), quantity: 400, kcal: 280, eatenAt: at(12) })!;
  expect(fixed.dish?.id).toBe(dish);
  expect(fixed.eatenAt).toBe(at(10)); // stays at the dish's time
  expect(listMeals(D).map((e) => e.kcal)).toEqual([280, 27]);

  deleteMeal(fixed.id);
  deleteMeal(grown[1]!.id);
  expect(db().query("SELECT 1 FROM meal_dishes WHERE id = ?").get(dish)).toBeNull();
});

test("copying a day keeps its dishes", () => {
  logDish(lunch(), null, { eatenAt: at(14), date: D, slot: "comida" });
  const copied = copyDay(D, "2034-05-11");
  expect(copied).toHaveLength(3);
  expect(new Set(copied.map((e) => e.dish?.name))).toEqual(new Set(["Tortitas de carne con queso y arroz"]));
});

test("a plan recipe saved as a dish is one portion of it", () => {
  const recipe = createRecipe({
    name: "Pasta boloñesa", servings: 4, prepMinutes: 30,
    ingredients: [
      { name: "Pasta", quantity: 400, unit: "g", kcal: 1400, protein: 48, carbs: 280, fat: 6 },
      { name: "Tomate triturado", quantity: 2, unit: "lata", kcal: 140, protein: 6, carbs: 28, fat: 1 },
    ],
  });
  const dish = saveRecipeAsDish(recipe.id);
  expect(dish.name).toBe("Pasta boloñesa");
  expect(dish.recipeId).toBe(recipe.id);
  expect(dish.components[0]).toMatchObject({ quantity: 100, unit: "g", kcal: 350 });
  expect(dish.components[1]).toMatchObject({ measure: { amount: 0.5, unit: "lata", size: null }, quantity: 177.5, unit: "ml", kcal: 35 });
});

test("a dish ties to the plan as one real meal named after it", () => {
  setTargets({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
  createPlan({
    name: "Plan", startsOn: D,
    days: [{ label: "A", meals: [
      { slot: "comida", name: "Pollo con arroz", items: [food("Pollo", 300), food("Arroz", 250)] },
      { slot: "merienda", name: "Yogur con fruta", items: [food("Yogur", 150)] },
    ] }],
  });
  const plan = activePlan()!;
  dietDay(plan, D);
  logDish(lunch(), "Tortitas de carne con queso y arroz", { eatenAt: at(14, 30), date: D, slot: "comida" });
  const comida = dietDay(plan, D).slots.find((s) => s.slot === "comida")!;
  expect(comida.status).toBe("replaced");
  expect(comida.real?.label).toBe("Tortitas de carne con queso y arroz");
  expect(comida.real?.entryIds).toHaveLength(3);
  expect(comida.real?.macros.kcal).toBe(770);
  expect(comida.replacedBy).toBe("Tortitas de carne con queso y arroz");

  // A dish named like the planned meal is the plan.
  logDish([food("Yogur griego", 150, { slot: "merienda" }), food("Fresas", 30, { slot: "merienda" })], "Yogur con fruta", { eatenAt: at(17, 30), date: D, slot: "merienda" });
  const merienda = dietDay(plan, D).slots.find((s) => s.slot === "merienda")!;
  expect(merienda.status).toBe("eaten");
  expect(merienda.real?.asPlanned).toBe(true);
});

test("ticking a planned meal of several foods logs it as a dish named like the meal", () => {
  createPlan({ name: "Plan", startsOn: D, days: [{ label: "A", meals: [{ slot: "comida", name: "Pollo con arroz", items: [food("Pollo", 300), food("Arroz", 250)] }] }] });
  const plan = activePlan()!;
  dietDay(plan, D);
  const slot = slotRows(plan.id, D)[0]!;
  const eaten = eatSlot(slot.id);
  expect(eaten.map((e) => e.dish?.name)).toEqual(["Pollo con arroz", "Pollo con arroz"]);
  expect(dietDay(plan, D).slots[0]!.status).toBe("eaten");
});

test("backfill: foods logged together before dishes existed become dishes, once", () => {
  const old = logMeals(lunch().map((f) => ({ ...f, eatenAt: at(14, 41), note: "tortitas con queso y arroz" })), "agent");
  logMeals([whey()].map((f) => ({ ...f, eatenAt: at(10, 5) })), "agent");
  // Logged in a later message, said to be in the shake.
  logMeals([strawberries()].map((f) => ({ ...f, eatenAt: at(10, 12) })), "agent");
  // An unrelated snack in the afternoon and yesterday's lone breakfast stay as they are.
  logMeals([food("Manzana", 80, { slot: "snack", eatenAt: at(17) })]);
  logMeals([food("Avena", 300, { slot: "desayuno", eatenAt: at(8, 0, "2034-05-09"), date: "2034-05-09" })]);

  expect(backfillDishes()).toBe(2);
  const day = listMeals(D);
  const dishes = [...new Set(day.flatMap((e) => (e.dish ? [e.dish.name] : [])))];
  expect(dishes).toEqual(["Batido de proteína con fresas", "Tortitas de carne con queso y arroz"]);
  const shake = day.filter((e) => e.dish?.name === "Batido de proteína con fresas");
  // The crammed name is kept as one component: splitting its macros would be a guess.
  expect(shake.map((e) => e.name)).toEqual([whey().name, strawberries().name]);
  expect(day.find((e) => e.name === "Manzana")!.dish).toBeNull();
  expect(listMeals("2034-05-09")[0]!.dish).toBeNull();
  expect(day.find((e) => e.id === old[0]!.id)!.kcal).toBe(130);
  expect(dailySummary(D).totals.kcal).toBe(770 + 347 + 80);

  expect(backfillDishes()).toBe(0);
});

test("backfill names a group eaten exactly as a planned meal after it, and ties its loose part to that meal", () => {
  createPlan({ name: "Plan", startsOn: D, days: [{ label: "A", meals: [{ slot: "comida", name: "Pollo con arroz", items: [food("Pollo", 300), food("Arroz", 250)] }] }] });
  const plan = activePlan()!;
  dietDay(plan, D);
  const slot = slotRows(plan.id, D)[0]!;
  const ticked = logMeals([{ ...food("Pollo", 300), eatenAt: at(14), slotId: slot.id, planItemId: JSON.parse(slot.items_json)[0].id }], "plan");
  logMeals([{ ...food("Arroz", 250), eatenAt: at(14, 1), slotId: slot.id, planItemId: JSON.parse(slot.items_json)[1].id }], "plan");
  expect(backfillDishes()).toBe(1);
  expect(listMeals(D).map((e) => e.dish?.name)).toEqual(["Pollo con arroz", "Pollo con arroz"]);
  expect(ticked[0]!.slotId).toBe(slot.id);
  const saved = saveDish({ name: "Pollo con arroz", components: listMeals(D).map((e) => ({ ...e, measure: null, barcode: null, caffeineMg: null, alcoholG: null })) });
  expect(saved.macros.kcal).toBe(550);
});
