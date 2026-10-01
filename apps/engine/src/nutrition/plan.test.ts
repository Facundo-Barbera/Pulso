import { beforeEach, expect, test } from "bun:test";
import type { DietPlanInput, Macros, PlanChange } from "@pulso/contract";
import { db } from "../db";
import { checkShoppingItems, generateShoppingList, getShoppingList, updateShoppingItem } from "../shopping/store";
import { ownDatabase } from "../web/test-db";
import { dietHorizon, prepView } from "./horizon";
import { ingredientUnavailable, moveSlot, noTimeToCook, prepCooked, rebalanceDay, schedulePrep, skipSlot, spread, undo, useLeftover } from "./ops";
import { createRecipe, getPrepRow } from "./recipes";
import { listRevisions } from "./revisions";
import { slotRows } from "./slots";
import { createPlan, logMeal, planForDay, saveAdjustment, setTargets } from "./store";

ownDatabase("plan");

beforeEach(() => {
  db().exec(`DELETE FROM diet_plans; DELETE FROM plan_slots; DELETE FROM plan_days; DELETE FROM plan_horizons; DELETE FROM plan_revisions;
    DELETE FROM prep_batches; DELETE FROM recipes; DELETE FROM meal_entries; DELETE FROM plan_adjustments; DELETE FROM pantry_items;
    DELETE FROM shopping_items; DELETE FROM shopping_list; DELETE FROM nutrition_targets;`);
  setTargets({ kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 28 });
});

const m = (kcal: number, protein = 0, carbs = 0, fat = 0): Macros => ({ kcal, protein, carbs, fat, fiber: 0 });
const food = (name: string, quantity: number, macros: Macros, unit: "g" | "ml" | "serving" = "g") => ({ name, quantity, unit, ...macros });
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

// Monday 2033-01-03. Two alternating 2000 kcal days: A (salmon dinner), B (hake dinner).
const [MON, TUE, WED, THU, , SAT] = days("2033-01-03", 6) as [string, string, string, string, string, string];
const SUN = "2033-01-02";
const noCompensation = { compensate: "none", spreadDays: 3, maxChangePct: 15 } as const;

const planInput = (): DietPlanInput => ({
  name: "Definición",
  startsOn: MON,
  days: [
    {
      label: "A",
      meals: [
        { slot: "desayuno", items: [food("Avena", 80, m(300, 10, 54, 6)), food("Leche semidesnatada", 250, m(100, 8, 12, 4), "ml")] },
        { slot: "comida", name: "Pollo con arroz", items: [food("Pechuga de pollo", 200, m(330, 62, 0, 7)), food("Arroz", 100, m(370, 7, 80, 1))] },
        { slot: "merienda", items: [food("Yogur griego", 2, m(300, 20, 30, 10), "serving")] },
        { slot: "cena", items: [food("Salmón", 200, m(600, 40, 0, 46))] },
      ],
    },
    {
      label: "B",
      meals: [
        { slot: "desayuno", items: [food("Avena", 80, m(300, 10, 54, 6)), food("Leche semidesnatada", 250, m(100, 8, 12, 4), "ml")] },
        { slot: "comida", name: "Lentejas", items: [food("Lentejas", 250, m(700, 45, 100, 10))] },
        { slot: "merienda", items: [food("Yogur griego", 2, m(300, 20, 30, 10), "serving")] },
        { slot: "cena", items: [food("Merluza", 250, m(600, 50, 20, 30))] },
      ],
    },
  ],
});

/** The slots of some dates as stored, for comparing before and after. */
const snapshot = (planId: string, ...dates: string[]) => JSON.stringify(dates.map((d) => slotRows(planId, d).map(({ updated_at: _u, ...r }) => r)));

test("an existing rotation plan is laid out as dated slots, once, keeping its item ids", () => {
  const plan = createPlan(planInput());
  const horizon = dietHorizon(MON, 4)!;
  expect(horizon.days.map((d) => d.label)).toEqual(["A", "B", "A", "B"]);
  expect(horizon.horizonDays).toBe(14);
  const monday = horizon.days[0]!;
  expect(monday.slots.map((s) => [s.slot, s.kind, s.status])).toEqual([
    ["desayuno", "items", "planned"],
    ["comida", "items", "planned"],
    ["merienda", "items", "planned"],
    ["cena", "items", "planned"],
  ]);
  expect(monday.slots[3]!.items[0]!.id).toBe(plan.days[0]!.meals[3]!.items[0]!.id);
  expect([monday.planned.kcal, monday.goalKcal]).toEqual([2000, 2000]);

  // Idempotent: reading again adds nothing, and the old reader sees the same day.
  const count = () => db().query<{ n: number }, []>("SELECT count(*) AS n FROM plan_slots").get()!.n;
  const before = count();
  dietHorizon(MON, 4);
  planForDay(MON);
  expect(count()).toBe(before);
  expect(planForDay(MON)!.day.meals.map((x) => x.items[0]!.id)).toEqual(plan.days[0]!.meals.map((x) => x.items[0]!.id));

  // A date whose meal moved away is not refilled from the rotation.
  moveSlot({ date: MON, slot: "cena", toDate: SAT, toSlot: "snack" });
  dietHorizon(MON, 6);
  expect(slotRows(plan.id, MON).map((r) => r.slot)).toEqual(["desayuno", "comida", "merienda"]);
});

test("skipping touches only that slot and, without compensation, nothing else", () => {
  const plan = createPlan(planInput());
  dietHorizon(MON, 7);
  const others = snapshot(plan.id, TUE, WED, THU);
  const out = skipSlot({ date: MON, slot: "desayuno", ...noCompensation });
  expect(out.summary).toBe("Saltaste desayuno del lun 3 (−400 kcal).");
  expect(out.slots.find((s) => s.slot === "desayuno")!.status).toBe("skipped");
  expect(out.slots.filter((s) => s.slot !== "desayuno").every((s) => s.status === "planned")).toBe(true);
  expect(out.compensation).toMatchObject({ mode: "none", deviationKcal: -400, unabsorbedKcal: -400 });
  expect(snapshot(plan.id, TUE, WED, THU)).toBe(others);
  // The old day view leaves the skipped meal out.
  expect(planForDay(MON)!.day.meals.map((x) => x.slot)).toEqual(["comida", "merienda", "cena"]);
});

test("a minor slip is absorbed the same day within the bound", () => {
  createPlan(planInput());
  const breakfast = dietHorizon(MON, 1)!.days[0]!.slots[0]!;
  // A Vualá (250 kcal) instead of the 400 kcal breakfast.
  const vuala = logMeal({ name: "Vualá", slot: "snack", quantity: 1, unit: "serving", ...m(250, 3, 30, 13), date: MON, offPlan: true, slotId: breakfast.id });
  expect(vuala.slotId).toBe(breakfast.id);
  expect(dietHorizon(MON, 1)!.days[0]!.slots[0]).toMatchObject({ status: "replaced", replacedBy: "Vualá" });

  const out = rebalanceDay({ date: MON, maxChangePct: 15 });
  // 1750 left for 1600 planned: everything ahead grows ~9 %.
  expect(out.adjustment.factor).toBe(1.09);
  expect(out.adjustment.meals.map((x) => x.slot)).toEqual(["comida", "merienda", "cena"]);
  expect(Math.abs(out.adjustment.projected.kcal - 2000)).toBeLessThan(40);
  expect(out.slots.find((s) => s.slot === "cena")!.adjusted![0]!.quantity).toBe(220);
});

test("the same-day bound holds even when the rest of the day could take more", () => {
  createPlan(planInput());
  dietHorizon(MON, 1);
  // A 1300 kcal breakfast: 900 over. The rest may shrink by 300 at most.
  logMeal({ name: "Brunch", slot: "desayuno", quantity: 1, unit: "serving", ...m(1300, 40, 120, 70), date: MON, offPlan: true });
  const out = rebalanceDay({ date: MON, maxChangePct: 15 });
  const planned = 1600;
  const after = out.adjustment.meals.flatMap((x) => x.items).reduce((t, i) => t + i.kcal, 0);
  expect(planned - after).toBeLessThanOrEqual(300 + 15);
  expect(planned - after).toBeGreaterThan(250);
});

test("a big deviation spread over the next days never moves a day more than 15 %", () => {
  createPlan(planInput());
  dietHorizon(MON, 7);
  // +1500 kcal at a dinner out on Monday; 15 % of 2000 is 300 per day.
  const out = spread({ date: MON, kcal: 1500, days: 3, maxChangePct: 15 });
  expect(out.compensation).toMatchObject({ mode: "spread", deviationKcal: 1500, absorbedKcal: 900, unabsorbedKcal: 600 });
  expect(out.compensation!.days).toEqual([
    { date: TUE, shiftKcal: -300 },
    { date: WED, shiftKcal: -300 },
    { date: THU, shiftKcal: -300 },
  ]);
  expect(out.summary).toContain("ningún día se mueve más de un 15 %");
  const horizon = dietHorizon(MON, 5)!;
  for (const day of horizon.days.slice(1, 4)) {
    expect(day.goalKcal).toBe(1700);
    // Lighter, but never by more than the bound once portions are rounded.
    const planned = day.slots.reduce((t, s) => t + s.macros.kcal, 0);
    expect(planned).toBeGreaterThanOrEqual(1700);
    expect(planned).toBeLessThan(1850);
  }
  // Monday and Friday untouched.
  expect(horizon.days[0]!.shiftKcal).toBe(0);
  expect(horizon.days[4]!.adjustment).toBeNull();
  // Spreading again can't push a day past the bound.
  expect(spread({ date: MON, kcal: 600, days: 3, maxChangePct: 15 }).compensation!.absorbedKcal).toBe(0);
  expect(dietHorizon(TUE, 1)!.days[0]!.shiftKcal).toBe(-300);
});

test("a missing ingredient is swapped only where it was used, and the list follows", () => {
  const plan = createPlan(planInput());
  dietHorizon(MON, 7);
  generateShoppingList({ from: MON, days: 4 });

  const preview = ingredientUnavailable({ ingredient: "salmón", from: MON, to: THU });
  if (!("preview" in preview)) throw new Error("expected a preview");
  expect(preview.affected.map((s) => s.date)).toEqual([MON, WED]);
  expect(preview.summary).toBe("Salmón aparece en 2 comidas (lun 3 y mié 5).");
  expect(slotRows(plan.id, MON).find((r) => r.slot === "cena")!.items_json).toContain("Salmón");

  const untouched = snapshot(plan.id, TUE, THU);
  const rest = () => JSON.stringify([MON, WED].map((d) => slotRows(plan.id, d).filter((r) => r.slot !== "cena").map((r) => r.items_json)));
  const others = rest();
  const out = ingredientUnavailable({
    ingredient: "salmón",
    from: MON,
    to: THU,
    substitute: { name: "Atún en conserva", ratio: 1, per100: { kcal: 110, protein: 25, carbs: 0, fat: 1, fiber: 0 } },
  }) as PlanChange;
  expect(out.summary).toBe("Cambié salmón por atún en conserva en 2 comidas (lun y mié).");
  expect(out.slots.find((s) => s.date === MON && s.slot === "cena")!.items[0]).toMatchObject({ name: "Atún en conserva", quantity: 200, kcal: 220, protein: 50 });
  expect(snapshot(plan.id, TUE, THU)).toBe(untouched);
  expect(rest()).toBe(others);

  // The list drops salmon and asks for the tuna instead.
  expect(out.shoppingRefreshed).toBe(true);
  const items = getShoppingList().items;
  expect(items.find((i) => i.name === "Salmón")).toBeUndefined();
  expect(items.find((i) => i.name === "Atún en conserva")).toMatchObject({ quantity: 400, amount: "400 g" });
});

test("undo puts back exactly what a change touched; an older change waits for a later one on the same days", () => {
  const plan = createPlan(planInput());
  dietHorizon(MON, 7);
  const before = snapshot(plan.id, MON, TUE, WED);
  skipSlot({ date: MON, slot: "desayuno", compensate: "day", spreadDays: 3, maxChangePct: 15 });
  const moved = moveSlot({ date: TUE, slot: "comida", toDate: WED });
  expect(moved.summary).toBe("Cambié comida del mar 4 (lentejas) por comida del mié 5 (pollo con arroz).");

  // The skip touched Monday only; the later move doesn't block undoing it.
  const skip = listRevisions(plan.id)[1]!;
  expect(undo(skip.id).summary).toStartWith("Deshecho: saltaste desayuno del lun 3");
  expect(dietHorizon(MON, 1)!.days[0]!.adjustment).toBeNull();
  undo();
  expect(snapshot(plan.id, MON, TUE, WED)).toBe(before);
  expect(() => undo()).toThrow("Nothing to undo");

  const a = skipSlot({ date: THU, slot: "merienda", ...noCompensation });
  skipSlot({ date: THU, slot: "desayuno", ...noCompensation });
  expect(() => undo(a.revision.id)).toThrow("undo «Saltaste desayuno del jue 6");
});

test("the shopping list is what the plan needs, minus what was ticked or «Ya tengo» on it; a new trip resets the marks", () => {
  createPlan(planInput());
  let list = generateShoppingList({ from: MON, days: 2 });
  const chicken = list.items.find((i) => i.name === "Pechuga de pollo")!;
  const rice = list.items.find((i) => i.name === "Arroz")!;
  expect(chicken.amount).toBe("200 g");
  expect(rice.quantity).toBe(100);

  checkShoppingItems([chicken.id]);
  updateShoppingItem(rice.id, { pantry: true });
  list = getShoppingList();
  expect(list.text).not.toContain("Pechuga de pollo");
  expect(list.text).not.toContain("Arroz");
  // Regenerating the same trip keeps both marks.
  list = generateShoppingList({ from: MON, days: 2 });
  expect(list.items.find((i) => i.id === chicken.id)).toMatchObject({ checked: true, pantry: false, amount: "200 g" });
  expect(list.items.find((i) => i.id === rice.id)).toMatchObject({ checked: false, pantry: true });
  checkShoppingItems([chicken.id], false);
  expect(getShoppingList().items.find((i) => i.id === chicken.id)!.checked).toBe(false);

  // A trip from Wednesday (chicken and rice again) starts fresh: the plan's full need, nothing marked.
  list = generateShoppingList({ from: WED, days: 1 });
  expect(list.items.find((i) => i.name === "Pechuga de pollo")).toMatchObject({ checked: false, pantry: false, amount: "200 g" });
  expect(list.items.find((i) => i.name === "Arroz")).toMatchObject({ pantry: false, quantity: 100 });
});

test("the old pantry table is kept but never read or written: not by ticks, «Ya tengo», eating or cooking", () => {
  createPlan(planInput());
  const at = Date.now();
  db()
    .query("INSERT INTO pantry_items (id, key, name, quantity, unit, category, source, created_at, updated_at) VALUES ('old', 'arroz|g', 'Arroz', 1000, 'g', 'panaderia_cereales', 'manual', ?, ?)")
    .run(at, at);
  const pantry = () => JSON.stringify(db().query("SELECT * FROM pantry_items").all());
  const before = pantry();

  // Rice at home no longer comes off the list.
  const list = generateShoppingList({ from: MON, days: 2 });
  expect(list.items.find((i) => i.name === "Arroz")).toMatchObject({ quantity: 100 });
  const chicken = list.items.find((i) => i.name === "Pechuga de pollo")!;
  checkShoppingItems([chicken.id]);
  updateShoppingItem(list.items.find((i) => i.name === "Arroz")!.id, { pantry: true });
  checkShoppingItems([chicken.id], false);
  const lunch = dietHorizon(MON, 1)!.days[0]!.slots.find((s) => s.slot === "comida")!;
  for (const item of lunch.items) logMeal({ ...item, slot: "comida", date: MON, planItemId: item.id });
  logMeal({ name: "Arroz", quantity: 80, unit: "g", kcal: 290, protein: 6, carbs: 62, fat: 1, fiber: 1, slot: "cena", date: MON, barcode: "8410000000011" });
  const prep = schedulePrep({ recipeId: bolognese().id, cookDate: TUE, portions: 2, assign: [{ date: WED, slot: "comida" }] });
  prepCooked({ prepId: prep.slots.find((s) => s.kind === "prep")!.prepId!, cooked: true });
  undo();
  expect(pantry()).toBe(before);
});

const bolognese = () =>
  createRecipe({
    name: "Pasta boloñesa",
    servings: 4,
    prepMinutes: 45,
    batch: true,
    ingredients: [
      food("Pasta", 320, m(1140, 40, 230, 5)),
      food("Carne picada de ternera", 500, m(1250, 100, 0, 90)),
      { name: "Tomate triturado", quantity: 1, unit: "lata" as const, ...m(110, 5, 20, 1) },
    ],
  });

test("a prep batch fills slots with portions, the list buys it once, leftovers are tracked", () => {
  createPlan(planInput());
  const recipe = bolognese();
  expect(recipe.perServing.kcal).toBe(625);
  const out = schedulePrep({ recipeId: recipe.id, cookDate: SUN, portions: 4, assign: [{ date: MON, slot: "comida" }, { date: TUE, slot: "comida" }, { date: WED, slot: "comida" }] });
  expect(out.summary).toBe("Batch de pasta boloñesa el dom 2 (4 raciones): 3 raciones para comida lun, comida mar y comida mié; 1 de sobra.");
  const prepId = out.slots.find((s) => s.kind === "prep")!.prepId!;
  expect(prepView(getPrepRow(prepId))).toMatchObject({ portions: 4, leftover: 1, eaten: 0, status: "planned" });
  expect(dietHorizon(MON, 1)!.days[0]!.slots.find((s) => s.slot === "comida")).toMatchObject({ kind: "prep", name: "Pasta boloñesa", cookMinutes: 0, macros: { kcal: 625 } });

  // The list asks for the whole batch once (cooked Sunday) and nothing for the lunches it replaced.
  const list = generateShoppingList({ from: SUN, days: 4 });
  expect(list.items.find((i) => i.name === "Pasta")).toMatchObject({ quantity: 320 });
  expect(list.items.find((i) => i.name === "Tomate triturado")).toMatchObject({ amount: "1 lata" });
  // Only Sunday's own lentils: Tuesday's lunch is a portion now.
  expect(list.items.find((i) => i.name === "Lentejas")).toMatchObject({ quantity: 250 });
  expect(list.items.find((i) => i.name === "Pechuga de pollo")).toBeUndefined();

  // Once cooked, the batch is off the list.
  prepCooked({ prepId, cooked: true });
  expect(generateShoppingList({ from: SUN, days: 4 }).items.find((i) => i.name === "Carne picada de ternera")).toBeUndefined();

  // The free portion goes to Thursday's lunch; skipping Tuesday's frees one again.
  useLeftover({ prepId, date: THU, slot: "comida" });
  expect(prepView(getPrepRow(prepId)).leftover).toBe(0);
  expect(() => useLeftover({ prepId, date: THU, slot: "cena" })).toThrow("No portion");
  skipSlot({ date: TUE, slot: "comida", ...noCompensation });
  expect(prepView(getPrepRow(prepId)).leftover).toBe(1);
  // Eating one counts it.
  const monday = dietHorizon(MON, 1)!.days[0]!.slots.find((s) => s.slot === "comida")!;
  logMeal({ ...monday.items[0]!, slot: "comida", date: MON, planItemId: monday.items[0]!.id });
  expect(prepView(getPrepRow(prepId)).eaten).toBe(1);
});

test("no time to cook: a free batch portion first, else a swap with a later day that needs no cooking", () => {
  const plan = createPlan(planInput());
  const recipe = bolognese();
  const stirFry = createRecipe({ name: "Salteado de ternera", servings: 1, prepMinutes: 25, ingredients: [food("Ternera", 150, m(300, 40, 0, 15)), food("Verduras", 200, m(80, 4, 14, 0))] });
  dietHorizon(MON, 7);
  for (const date of [TUE, WED]) {
    db().query("UPDATE plan_slots SET kind = 'recipe', recipe_id = ?, name = ?, portions = 1 WHERE plan_id = ? AND date = ? AND slot = 'comida'").run(stirFry.id, stirFry.name, plan.id, date);
  }
  expect(() => noTimeToCook({ date: TUE, strategy: "leftover" })).toThrow("No batch portion free");

  // No batch yet: Tuesday's stir-fry swaps with Thursday's lentils (Wednesday's lunch needs cooking too).
  const moved = noTimeToCook({ date: TUE, strategy: "auto" });
  expect(moved.summary).toBe("Comida del mar 4: lentejas; salteado de ternera pasa al jue 6.");

  // With a batch from Sunday and a portion free, Wednesday eats that.
  schedulePrep({ recipeId: recipe.id, cookDate: SUN, portions: 2, assign: [{ date: MON, slot: "comida" }] });
  const leftover = noTimeToCook({ date: WED, strategy: "auto" });
  expect(leftover.summary).toBe("Comida del mié 5: pasta boloñesa del batch del dom 2 en vez de salteado de ternera.");
  expect(leftover.slots.find((s) => s.date === WED && s.slot === "comida")).toMatchObject({ kind: "prep", cookMinutes: 0 });
});

test("a legacy adjustment stays laid over the dated day", () => {
  const plan = createPlan(planInput());
  saveAdjustment({
    date: MON, planId: plan.id, dayIndex: 0, factor: 0.8, eaten: m(0), targets: m(2000), projected: m(0), summary: "Cena al 80 %.", note: null, createdAt: Date.now(),
    meals: [{ slot: "cena", name: null, change: "scaled", items: [{ ...plan.days[0]!.meals[3]!.items[0]!, quantity: 160, kcal: 480 }] }],
  });
  const dinner = dietHorizon(MON, 1)!.days[0]!.slots.find((s) => s.slot === "cena")!;
  expect(dinner.items[0]!.quantity).toBe(200);
  expect(dinner.adjusted![0]!.quantity).toBe(160);
  expect(dinner.macros.kcal).toBe(480);
});

test("undoing a batch change restores whole days, not only the portions", () => {
  const plan = createPlan(planInput());
  dietHorizon(MON, 7);
  const before = snapshot(plan.id, MON, TUE, WED);
  const recipe = bolognese();
  const out = schedulePrep({ recipeId: recipe.id, cookDate: SUN, portions: 3, assign: [{ date: MON, slot: "comida" }, { date: TUE, slot: "comida" }] });
  const prepId = out.slots.find((s) => s.kind === "prep")!.prepId!;
  // A later change on another day that uses the batch widens to the portions' days.
  useLeftover({ prepId, date: WED, slot: "cena" });
  undo();
  expect(slotRows(plan.id, MON).map((r) => r.slot)).toEqual(["desayuno", "comida", "merienda", "cena"]);
  expect(prepView(getPrepRow(prepId)).leftover).toBe(1);
  undo();
  expect(snapshot(plan.id, MON, TUE, WED)).toBe(before);
  expect(() => getPrepRow(prepId)).toThrow("No prep batch");
});
