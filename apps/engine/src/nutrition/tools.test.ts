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
