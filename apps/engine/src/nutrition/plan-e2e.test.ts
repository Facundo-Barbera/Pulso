/**
 * The person's real week, through the Coach's tools: a two-week plan, the list
 * for it, a few ticks, a breakfast swapped for a Vualá, salmon missing at the
 * supermarket, a day without time to cook, and undoing the last change.
 */
import { expect, test } from "bun:test";
import { z } from "zod";
import { TOOLS } from "../agent/registry";
import { ownDatabase } from "../web/test-db";

ownDatabase("plan-e2e");

async function call(name: string, args: unknown = {}) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const text = (result.content[0] as { text: string }).text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

const item = (name: string, quantity: number, kcal: number, protein: number, unit = "g") => ({ name, quantity, unit, kcal, protein, carbs: 0, fat: 0 });
const MON = "2034-05-01";
const day = (offset: number) => new Date(Date.parse(`${MON}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const TUE = day(1);
const WED = day(2);
const SUN = day(-1);

test("a real week: plan → list → ticks → Vualá → no salmon → no time to cook → undo", async () => {
  await call("set_targets", { kcal: 2000, protein: 150, carbs: 200, fat: 70 });
  const plan = await call("create_diet_plan", {
    name: "Definición",
    startsOn: MON,
    horizonDays: 14,
    days: [
      {
        label: "Entreno",
        meals: [
          { slot: "desayuno", items: [item("Avena", 80, 300, 10), item("Leche semidesnatada", 250, 100, 8, "ml")] },
          { slot: "comida", items: [item("Pechuga de pollo", 200, 330, 62), item("Arroz", 100, 370, 7)] },
          { slot: "merienda", items: [item("Yogur griego", 2, 300, 20, "serving")] },
          { slot: "cena", items: [item("Salmón", 200, 600, 40)] },
        ],
      },
      {
        label: "Descanso",
        meals: [
          { slot: "desayuno", items: [item("Avena", 80, 300, 10), item("Leche semidesnatada", 250, 100, 8, "ml")] },
          { slot: "comida", items: [item("Lentejas", 250, 700, 45)] },
          { slot: "merienda", items: [item("Yogur griego", 2, 300, 20, "serving")] },
          { slot: "cena", items: [item("Merluza", 250, 600, 50)] },
        ],
      },
    ],
  });

  // Pasta boloñesa is great but there's no time on weekdays: a Sunday batch for Mon–Wed lunches.
  const recipe = await call("create_recipe", {
    name: "Pasta boloñesa",
    servings: 4,
    prepMinutes: 45,
    batch: true,
    ingredients: [item("Pasta", 320, 1140, 40), item("Carne picada de ternera", 500, 1250, 100), { ...item("Tomate triturado", 1, 110, 5), unit: "lata" }],
  });
  const prep = await call("schedule_prep", { recipeId: recipe.id, cookDate: SUN, portions: 4, assign: [{ date: MON, slot: "comida" }, { date: TUE, slot: "comida" }] });
  expect(prep.summary).toContain("2 raciones para comida lun y comida mar; 2 de sobra");

  // The two-week list, from Sunday.
  let list = await call("generate_shopping_list", { from: SUN, days: 14 });
  const byName = (name: string) => list.items.find((i: { name: string }) => i.name === name);
  expect(byName("Pasta")).toMatchObject({ quantity: 320 });
  expect(byName("Salmón")).toBeDefined();
  // Ticks feed the pantry.
  list = await call("check_shopping_items", { ids: [byName("Pasta").id, byName("Avena").id] });
  const pantry = await call("get_pantry");
  expect(pantry.map((p: { name: string }) => p.name).sort()).toEqual(["Avena", "Pasta"]);

  // Tuesday: breakfast skipped, a Vualá instead (minor: absorbed the same day).
  const horizon = await call("get_diet_horizon", { from: TUE, days: 1 });
  const breakfast = horizon.days[0].slots.find((s: { slot: string }) => s.slot === "desayuno");
  const [vuala] = await call("log_meal", {
    date: TUE, at: "10:30", offPlan: true, slotId: breakfast.id, description: "Un Vualá de la máquina",
    items: [{ name: "Vualá", slot: "snack", measure: "1 unidad", kcal: 250, protein: 3, carbs: 30, fat: 13 }],
  });
  expect(vuala.slotId).toBe(breakfast.id);
  const absorbed = await call("rebalance_day", { date: TUE });
  expect(absorbed.adjustment.factor).toBeGreaterThan(1);
  expect(absorbed.adjustment.factor).toBeLessThanOrEqual(1.15);
  const tuesday = (await call("get_diet_horizon", { from: TUE, days: 1 })).days[0];
  expect(tuesday.slots.find((s: { slot: string }) => s.slot === "desayuno")).toMatchObject({ status: "replaced", replacedBy: "Vualá" });
  // Wednesday is untouched.
  expect((await call("get_diet_horizon", { from: WED, days: 1 })).days[0].adjustment).toBeNull();

  // At the supermarket: "no encontré salmón". Preview, then tuna.
  const preview = await call("ingredient_unavailable", { ingredient: "salmón", from: MON });
  expect(preview.preview).toBe(true);
  expect(preview.affected.length).toBeGreaterThan(0);
  const salmonDays = preview.affected.map((s: { date: string }) => s.date);
  const swapped = await call("ingredient_unavailable", {
    ingredient: "salmón", from: MON, substitute: { name: "Atún", per100: { kcal: 110, protein: 25, carbs: 0, fat: 1 } },
  });
  expect(swapped.summary).toStartWith(`Cambié salmón por atún en ${salmonDays.length} comidas`);
  expect(swapped.shoppingRefreshed).toBe(true);
  list = await call("get_shopping_list");
  expect(byName("Salmón")).toBeUndefined();
  expect(byName("Atún")).toBeDefined();
  // The ticks survived the rebuild.
  expect(byName("Pasta")).toMatchObject({ checked: true });

  // Wednesday: "hoy no cocino". The batch's free portion covers lunch.
  await call("fill_slot", { date: WED, slot: "comida", fill: { kind: "items", name: "Salteado", items: [item("Ternera", 150, 400, 40), item("Verduras", 200, 300, 10)] } });
  const fillChange = await call("list_plan_changes", { limit: 1 });
  expect(fillChange[0].op).toBe("fill");
  const noTime = await call("no_time_to_cook", { date: WED, slot: "comida", strategy: "leftover" });
  expect(noTime.summary).toBe("Comida del mié 3: pasta boloñesa del batch del dom 30 en vez de salteado.");

  // "Mejor no": undo the last change only.
  const undone = await call("undo_plan_change");
  expect(undone.summary).toStartWith("Deshecho: comida del mié 3");
  const wednesday = (await call("get_diet_horizon", { from: WED, days: 1 })).days[0];
  expect(wednesday.slots.find((s: { slot: string }) => s.slot === "comida")).toMatchObject({ kind: "items", name: "Salteado" });
  // Everything else stays as it was: the tuna, the Vualá, the batch.
  // (Within the horizon: salmon may be back in the shops by the next one.)
  const after = await call("get_diet_horizon", { from: MON, days: 14 });
  const dinners = after.days.flatMap((d: { slots: { slot: string; items: { name: string }[] }[] }) => d.slots.filter((s) => s.slot === "cena").map((s) => s.items[0]!.name));
  expect(dinners).not.toContain("Salmón");
  expect(after.days[1].slots[0]).toMatchObject({ status: "replaced" });
  expect(after.preps[0]).toMatchObject({ leftover: 2 });
  // The plan was never regenerated.
  expect((await call("get_active_plan", { date: TUE })).plan.id).toBe(plan.id);
});
