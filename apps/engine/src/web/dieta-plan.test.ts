import { expect, test } from "bun:test";
import type { Macros } from "@pulso/contract";
import { fillSlot, schedulePrep, skipSlot } from "../nutrition/ops";
import { createRecipe } from "../nutrition/recipes";
import { createPlan } from "../nutrition/store";
import { dietaDaySlots, dietaLivingPlan } from "./dieta-plan";
import { ownDatabase } from "./test-db";

ownDatabase("dieta-plan");

const m = (kcal: number, protein = 0): Macros => ({ kcal, protein, carbs: 0, fat: 0, fiber: 0 });
const food = (name: string, quantity: number, macros: Macros) => ({ name, quantity, unit: "g" as const, ...macros });

// Sunday 2034-01-01, then a week.
const SUN = "2034-01-01";
const MON = "2034-01-02";
const TUE = "2034-01-03";

test("the living plan names where each meal comes from, numbers batch portions and puts the cooking on its day", () => {
  createPlan({
    name: "Mantenimiento",
    startsOn: SUN,
    days: [
      {
        label: "Diario",
        meals: [
          { slot: "desayuno", items: [food("Avena", 80, m(300, 10))] },
          { slot: "comida", items: [food("Pollo", 200, m(330, 62))] },
          { slot: "cena", items: [food("Tortilla", 200, m(400, 25))] },
        ],
      },
    ],
  });
  const pot = createRecipe({ name: "Pollo con arroz", servings: 4, prepMinutes: 45, batch: true, ingredients: [food("Pechuga", 800, m(1320, 248)), food("Arroz", 400, m(1480, 28))] });
  const quick = createRecipe({ name: "Ensalada de atún", servings: 1, prepMinutes: 10, ingredients: [food("Atún", 120, m(150, 30))] });
  schedulePrep({ recipeId: pot.id, cookDate: SUN, portions: 4, assign: [{ date: MON, slot: "comida" }, { date: TUE, slot: "comida" }] });
  fillSlot({ date: MON, slot: "cena", fill: { kind: "recipe", recipeId: quick.id, portions: 1 } });
  fillSlot({ date: TUE, slot: "cena", fill: { kind: "eat_out", name: "Cena con amigos", kcal: 800, protein: 30, carbs: 80, fat: 35, fiber: 5 } });
  skipSlot({ date: MON, slot: "desayuno", compensate: "none", spreadDays: 3, maxChangePct: 15 });

  const plan = dietaLivingPlan(SUN, 3)!;
  expect(plan.days.map((d) => d.date)).toEqual([SUN, MON, TUE]);
  expect(plan.days[0]!.preps.map((p) => [p.recipeName, p.portions])).toEqual([["Pollo con arroz", 4]]);

  const monday = plan.days[1]!;
  const bySlot = Object.fromEntries(monday.slots.map((s) => [s.slot, s]));
  expect(bySlot.comida!.source).toBe("Porción del prep · Pollo con arroz · 1 de 4");
  expect(bySlot.cena!.source).toBe("Receta rápida · 10 min");
  expect(bySlot.cena!.cooks).toBe(false);
  expect(bySlot.desayuno!.status).toBe("skipped");
  expect(plan.days[2]!.slots.find((s) => s.slot === "comida")!.source).toBe("Porción del prep · Pollo con arroz · 2 de 4");
  expect(plan.days[2]!.slots.find((s) => s.slot === "cena")!.source).toBe("Comer fuera");
  expect(Object.keys(plan.recipes).sort()).toEqual([pot.id, quick.id].sort());
  expect(plan.revisions.map((r) => r.op)).toEqual(["skip", "fill", "fill", "schedule_prep"]);
});

test("a past date shows slots only when it was laid out", () => {
  expect(dietaDaySlots("2033-12-01", MON)).toBeNull();
  expect(dietaDaySlots(MON, MON)?.slots.length).toBe(3);
});
