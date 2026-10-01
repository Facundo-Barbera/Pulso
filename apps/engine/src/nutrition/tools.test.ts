import { expect, test } from "bun:test";
import { z } from "zod";
import { TOOLS } from "../agent/registry";
import { nutritionTools } from "./tools";

/** Runs a tool the way the MCP server does: validate the raw shape, then call the handler. */
async function call(name: string, args: unknown) {
  const t = nutritionTools.find((x) => x.name === name)!;
  const parsed = z.object(t.inputSchema).parse(args);
  const result = await t.handler(parsed as never, undefined);
  const text = (result.content[0] as { text: string }).text;
  return { error: result.isError === true, text, value: result.isError ? undefined : JSON.parse(text) };
}

test("every nutrition tool is registered", () => {
  const names = TOOLS.map((t) => t.name);
  for (const t of nutritionTools) expect(names).toContain(t.name);
});

test("log_meal → daily_summary → delete_meal", async () => {
  await call("set_targets", { kcal: 2500, protein: 180, carbs: 250, fat: 80, fiber: 30 });
  const logged = await call("log_meal", {
    items: [
      { name: "Huevos", slot: "desayuno", quantity: 2, unit: "serving", kcal: 155, protein: 13, carbs: 1, fat: 11, date: "2032-05-01" },
      { name: "Pan", slot: "desayuno", quantity: 40, kcal: 100, protein: 3.5, carbs: 19, fat: 1.2, fiber: 2.5, date: "2032-05-01" },
    ],
  });
  expect(logged.value).toHaveLength(2);
  expect(logged.value[0].source).toBe("agent");
  expect(logged.value[1].unit).toBe("g");

  const summary = (await call("daily_summary", { date: "2032-05-01" })).value;
  expect(summary.totals.kcal).toBe(255);
  expect(summary.remaining.protein).toBe(163.5);

  expect((await call("list_meals", { from: "2032-05-01" })).value).toHaveLength(2);
  expect((await call("delete_meal", { id: logged.value[0].id })).error).toBe(false);
  expect((await call("delete_meal", { id: logged.value[0].id })).error).toBe(true);
});

test("list_meals rejects inverted or huge ranges", async () => {
  expect((await call("list_meals", { from: "2032-02-01", to: "2032-01-01" })).error).toBe(true);
  expect((await call("list_meals", { from: "2032-01-01", to: "2032-06-01" })).error).toBe(true);
});

test("create_diet_plan in one call, then get_active_plan", async () => {
  const created = await call("create_diet_plan", {
    name: "Volumen 2800",
    notes: "2 L de agua",
    startsOn: "2032-07-01",
    days: [
      {
        label: "Todos los días",
        meals: [
          { slot: "desayuno", items: [{ name: "Avena", quantity: 80, unit: "g", kcal: 304, protein: 11, carbs: 53, fat: 5.6, fiber: 8 }] },
          { slot: "cena", name: "Salmón", items: [{ name: "Salmón", quantity: 200, unit: "g", kcal: 416, protein: 40, carbs: 0, fat: 28 }] },
        ],
      },
    ],
  });
  expect(created.value.active).toBe(true);
  const active = (await call("get_active_plan", { date: "2032-07-09" })).value;
  expect(active.plan.id).toBe(created.value.id);
  expect(active.day.meals).toHaveLength(2);
  expect(active.eatenItemIds).toEqual([]);
});

test("create_diet_plan rejects a plan without days", async () => {
  await expect(call("create_diet_plan", { name: "Vacío", days: [] })).rejects.toThrow();
});

test("lookup_food_barcode rejects malformed codes without fetching", async () => {
  const result = await call("lookup_food_barcode", { barcode: "abc" });
  expect(result.error).toBe(true);
});

test("log_meal takes the time the person said, their words and off-plan", async () => {
  const logged = await call("log_meal", {
    at: "14:00",
    date: "2032-08-01",
    description: "Big Mac y papas medianas",
    offPlan: true,
    items: [
      { name: "Big Mac", slot: "comida", quantity: 1, unit: "serving", kcal: 590, protein: 25, carbs: 46, fat: 34, fiber: 3 },
      { name: "Papas medianas", slot: "comida", quantity: 111, kcal: 320, protein: 5, carbs: 43, fat: 15, fiber: 4 },
    ],
  });
  const at = new Date(2032, 7, 1, 14, 0).getTime();
  expect(logged.value.map((e: { eatenAt: number }) => e.eatenAt)).toEqual([at, at]);
  expect(logged.value[0]).toMatchObject({ date: "2032-08-01", offPlan: true, note: "Big Mac y papas medianas", source: "agent" });
  const listed = (await call("list_meals", { from: "2032-08-01" })).value;
  expect(listed[1]).toMatchObject({ name: "Papas medianas", offPlan: true, note: "Big Mac y papas medianas" });

  const iso = (await call("log_meal", { at: "2032-08-02T08:15", items: [{ name: "Café", slot: "desayuno", quantity: 1, unit: "serving", kcal: 5, protein: 0, carbs: 0, fat: 0 }] })).value;
  expect(iso[0]).toMatchObject({ date: "2032-08-02", eatenAt: new Date(2032, 7, 2, 8, 15).getTime(), offPlan: false, note: null });
  expect((await call("log_meal", { at: "después de comer", items: [{ name: "x", slot: "snack", quantity: 1, kcal: 1, protein: 0, carbs: 0, fat: 0 }] })).error).toBe(true);
});

test("adjust_day_plan rewrites the rest of the day, and fails without a plan to adjust", async () => {
  await call("set_targets", { kcal: 2000, protein: 150, carbs: 200, fat: 70, fiber: 25 });
  await call("create_diet_plan", {
    name: "Plan diario",
    startsOn: "2032-09-01",
    days: [
      {
        label: "Todos",
        meals: [
          { slot: "comida", items: [{ name: "Pollo con arroz", quantity: 1, unit: "serving", kcal: 700, protein: 55, carbs: 80, fat: 15 }] },
          { slot: "cena", items: [{ name: "Salmón", quantity: 200, unit: "g", kcal: 600, protein: 40, carbs: 0, fat: 46 }] },
        ],
      },
    ],
  });
  await call("log_meal", { at: "14:00", date: "2032-09-03", offPlan: true, items: [{ name: "Big Mac", slot: "comida", quantity: 1, unit: "serving", kcal: 1500, protein: 40, carbs: 150, fat: 80 }] });
  const swap = { slot: "cena", name: "Cena ligera", items: [{ name: "Pechuga", quantity: 150, unit: "g", kcal: 250, protein: 46, carbs: 0, fat: 5 }] };
  const adjusted = (await call("adjust_day_plan", { date: "2032-09-03", swaps: [swap], note: "Cena ligera tras la hamburguesa" })).value;
  expect(adjusted).toMatchObject({ stored: true, note: "Cena ligera tras la hamburguesa" });
  expect(adjusted.meals).toHaveLength(1);
  expect(adjusted.meals[0]).toMatchObject({ slot: "cena", change: "swapped" });
  expect(adjusted.projected.kcal).toBe(1750);
  expect((await call("get_active_plan", { date: "2032-09-03" })).value.adjustment.meals[0].name).toBe("Cena ligera");

  await call("create_diet_plan", { name: "Borrador", activate: false, days: [{ label: "x", meals: [{ slot: "cena", items: [{ name: "x", quantity: 1, unit: "g", kcal: 1, protein: 0, carbs: 0, fat: 0 }] }] }] });
  // A newer active plan voids the old adjustment.
  await call("create_diet_plan", { name: "Nuevo", startsOn: "2032-09-01", days: [{ label: "x", meals: [{ slot: "cena", items: [{ name: "Tofu", quantity: 200, unit: "g", kcal: 300, protein: 30, carbs: 5, fat: 18 }] }] }] });
  expect((await call("get_active_plan", { date: "2032-09-03" })).value.adjustment).toBeNull();
});

test("log_water converts the person's units and get_water reports the day", async () => {
  const glass = (await call("log_water", { amount: 2, unit: "vaso", at: "10:00", date: "2032-10-01" })).value;
  expect(glass.entry).toMatchObject({ amountMl: 500, source: "agent", date: "2032-10-01" });
  await call("log_water", { amount: 1.5, unit: "l", date: "2032-10-01" });
  const day = (await call("get_water", { date: "2032-10-01" })).value;
  expect(day.totalMl).toBe(2000);
  expect(day.entries).toHaveLength(2);
  expect((await call("log_water", { amount: 8, unit: "l" })).error).toBe(true);
  expect((await call("set_water_goal", { goalMl: 2800 })).value.goalMl).toBe(2800);
  expect((await call("get_water", { date: "2032-10-01" })).value).toMatchObject({ goalMl: 2800, goalSource: "custom" });
  await call("set_water_goal", { goalMl: null });
});
