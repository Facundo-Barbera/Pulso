import { beforeEach, expect, test } from "bun:test";
import type { MealInput, PlanSlot } from "@pulso/contract";
import { db } from "../db";
import { ownDatabase } from "../web/test-db";
import { dietDay, slotViews } from "./horizon";
import { ateOut, placeEntries, skipSlot, undo } from "./ops";
import { reconcileBacklog } from "./reconcile";
import { listRevisions } from "./revisions";
import { slotRows } from "./slots";
import { activePlan, createPlan, deleteMeal, eatPlanItem, listMeals, logMeal, logMeals, setTargets } from "./store";

ownDatabase("reconcile");

// Wednesday 2033-03-02 shaped like the person's day: a planned breakfast, lunch, merienda and dinner.
const D = "2033-03-02";
const at = (h: number, m = 0, date = D) => {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, m).getTime();
};
const meal = (name: string, kcal: number, protein = 0) => ({ name, quantity: 1, unit: "serving" as const, kcal, protein, carbs: 0, fat: 0, fiber: 0 });

beforeEach(() => {
  db().exec(`DELETE FROM diet_plans; DELETE FROM plan_slots; DELETE FROM plan_days; DELETE FROM plan_revisions; DELETE FROM meal_entries;
    DELETE FROM meal_slot_links; DELETE FROM meal_entry_pins; DELETE FROM plan_adjustments; DELETE FROM nutrition_targets; DELETE FROM meal_times;`);
  setTargets({ kcal: 1900, protein: 140, carbs: 180, fat: 60 });
  createPlan({
    name: "Recomposición",
    startsOn: D,
    days: [
      {
        label: "Día A",
        meals: [
          { slot: "desayuno", name: "Sándwich de huevo y pavo", items: [meal("Pan integral", 160, 8), meal("Huevo", 156, 13), meal("Pavo", 112, 18)] },
          { slot: "comida", name: "Pasta boloñesa", items: [meal("Pasta", 350, 12), meal("Boloñesa", 267, 25)] },
          { slot: "merienda", name: "Proteína whey con plátano", items: [meal("Proteína whey", 195, 25), meal("Plátano", 105, 1)] },
          { slot: "cena", name: "Quesadillas de pollo", items: [meal("Tortillas de maíz", 220, 5), meal("Pollo", 200, 35), meal("Queso", 113, 7)] },
        ],
      },
    ],
  });
  dietDay(activePlan()!, D); // lays the date out
});

const food = (name: string, slot: MealInput["slot"], kcal: number, eatenAt: number, extra: Partial<MealInput> = {}): MealInput => ({
  name, slot, quantity: 100, unit: "g", kcal, protein: 10, carbs: 10, fat: 5, fiber: 0, eatenAt, date: D, ...extra,
});
const slots = (now = at(23, 59)) => slotViews(slotRows(activePlan()!.id, D), now);
const bySlot = (s: PlanSlot["slot"], now?: number) => slots(now).find((x) => x.slot === s)!;
const statuses = () => Object.fromEntries(slots().map((s) => [s.slot, s.status]));

test("a breakfast skipped and a Vualá at 11:11 is the real breakfast; lunch eaten instead of the plan; a Coca Zero stays an extra", () => {
  const [vuala] = logMeals([food("Vualá Big", "snack", 369, at(11, 11), { note: "Me comí un big vuala" })], "agent");
  expect(vuala!.slotId).toBe(bySlot("desayuno").id);
  expect(vuala!.offPlan).toBe(true); // derived: eaten instead

  logMeals(
    [
      food("Tortitas de carne de res", "comida", 600, at(14, 41)),
      food("Queso amarillo", "comida", 150, at(14, 41)),
      food("Arroz blanco", "comida", 215, at(14, 41)),
    ],
    "agent",
  );
  const [coke] = logMeals([food("Coca-Cola Zero", "snack", 0, at(14, 51), { unit: "ml", quantity: 500 })], "agent");
  expect(coke!.slotId).toBeNull();

  const lunch = bySlot("comida");
  expect(lunch.status).toBe("replaced");
  expect(lunch.real).toMatchObject({ label: "Tortitas de carne de res, queso amarillo y arroz blanco", asPlanned: false });
  expect(lunch.real!.macros.kcal).toBe(965);
  expect(lunch.real!.entryIds).toHaveLength(3);
  expect(statuses()).toEqual({ desayuno: "replaced", comida: "replaced", merienda: "planned", cena: "planned" });

  const day = dietDay(activePlan()!, D);
  expect(day.extraIds).toEqual([coke!.id]);
  expect(day.real.kcal).toBe(1334);
  expect(day.asPlanned.kcal).toBe(428 + 617 + 300 + 533);
  // One revision per meal tied, none for the extra.
  expect(listRevisions(activePlan()!.id).map((r) => r.summary)).toEqual([
    "Comida del mié 2: tortitas de carne de res, queso amarillo y arroz blanco en vez de pasta boloñesa (+348 kcal).",
    "Desayuno del mié 2: vualá Big en vez de sándwich de huevo y pavo (−59 kcal).",
  ]);
});

test("windows follow the person's meal times; lunch logged late is still lunch", () => {
  db().query("INSERT INTO meal_times (date, slot, time) VALUES (?, 'desayuno', '07:00'), (?, 'comida', '13:00'), (?, 'merienda', '17:00'), (?, 'cena', '21:00')").run(D, D, D, D);
  // Breakfast window ends 11:30 (90 min before lunch): 11:40 is lunch.
  const [early] = logMeals([food("Burrito", "snack", 500, at(11, 40))]);
  expect(early!.slotId).toBe(bySlot("comida").id);
  // Said it was dinner: dinner, whatever the hour.
  const [late] = logMeals([food("Ensalada", "cena", 300, at(17, 10))]);
  expect(late!.slotId).toBe(bySlot("cena").id);
});

test("several logs in one meal's window group into one real meal; small snacks between meals stay extras", () => {
  logMeal(food("Torta de milanesa", "snack", 650, at(14, 5)));
  logMeal(food("Agua de horchata", "snack", 280, at(14, 20), { unit: "ml", quantity: 400 }));
  const lunch = bySlot("comida");
  expect(lunch.real?.label).toBe("Torta de milanesa y agua de horchata");
  expect(lunch.real?.macros.kcal).toBe(930);

  // Under 250 kcal between meals: an extra, not the merienda.
  const [nuts] = logMeals([food("Almendras", "snack", 170, at(17, 20))]);
  expect(nuts!.slotId).toBeNull();
  expect(bySlot("merienda").status).toBe("planned");
  // A coffee logged as breakfast is not a breakfast.
  const [coffee] = logMeals([food("Café", "desayuno", 5, at(8, 0), { unit: "ml", quantity: 200 })]);
  expect(coffee!.slotId).toBeNull();
  // The first food of the day, even small, is breakfast.
  const [yogurt] = logMeals([food("Yogur", "snack", 140, at(8, 30))]);
  expect(yogurt!.slotId).toBe(bySlot("desayuno").id);
});

test("eating the plan's own items is the meal as planned, with no revision", () => {
  const breakfast = activePlan()!.days[0]!.meals[0]!;
  for (const item of breakfast.items) eatPlanItem(item.id, D, at(8, 10));
  const slot = bySlot("desayuno");
  expect(slot.status).toBe("eaten");
  expect(slot.real).toMatchObject({ asPlanned: true, label: "Pan integral, huevo y pavo" });
  expect(listRevisions(activePlan()!.id)).toHaveLength(0);
  // Told to the Coach by name, without ids: still the plan.
  logMeal(food("Pasta", "comida", 350, at(14, 0)));
  logMeal(food("Boloñesa", "comida", 267, at(14, 0)));
  expect(bySlot("comida").status).toBe("eaten");
  // Something after a meal eaten as planned is an extra, not a replacement.
  const [dessert] = logMeals([food("Pastel", "snack", 420, at(14, 30))]);
  expect(dessert!.slotId).toBeNull();
});

test("deleting the last real entry puts the meal back to pending; deleting one of several keeps it", () => {
  const [a, b] = logMeals([food("Tacos", "comida", 600, at(14, 0)), food("Refresco", "comida", 140, at(14, 0), { unit: "ml", quantity: 355 })]);
  deleteMeal(b!.id);
  expect(bySlot("comida").status).toBe("replaced");
  expect(bySlot("comida").real?.label).toBe("Tacos");
  deleteMeal(a!.id);
  expect(bySlot("comida").status).toBe("planned");
  expect(bySlot("comida").real).toBeNull();
});

test("undo unties a meal tied by inference and keeps what was logged", () => {
  const [entry] = logMeals([food("Pizza", "comida", 900, at(14, 0))]);
  expect(bySlot("comida").status).toBe("replaced");
  undo();
  expect(bySlot("comida").status).toBe("planned");
  expect(listMeals(D).map((e) => [e.id, e.slotId])).toEqual([[entry!.id, null]]);
});

test("«eso fue un snack» makes it an extra for good; «eso fue mi merienda» moves it", () => {
  const [vuala] = logMeals([food("Vualá Big", "snack", 369, at(11, 11))]);
  placeEntries({ entryIds: [vuala!.id], extra: true });
  expect(bySlot("desayuno").status).toBe("planned");
  expect(reconcileBacklog(D)).toBe(0); // pinned: never tied again
  expect(listMeals(D)[0]!.slotId).toBeNull();

  const change = placeEntries({ entryIds: [vuala!.id], slot: "merienda" });
  expect(change.summary).toBe("Vualá Big pasa a ser la merienda del mié 2 (en vez de proteína whey con plátano).");
  expect(bySlot("merienda").real?.label).toBe("Vualá Big");
  undo();
  expect(bySlot("merienda").status).toBe("planned");
  expect(listMeals(D)[0]!.slotId).toBeNull();
});

test("«Comí fuera» logs an estimate as the real meal; undo deletes it", () => {
  const change = ateOut({ date: D, slot: "cena", compensate: "none", spreadDays: 3, maxChangePct: 15 });
  const dinner = bySlot("cena");
  expect(dinner.status).toBe("replaced");
  expect(dinner.real?.label).toBe("Comida fuera");
  expect(dinner.real?.macros.kcal).toBe(692.9);
  expect(change.summary).toStartWith("Cena del mié 2: comiste fuera en vez de quesadillas de pollo (693 kcal, estimado");
  expect(() => ateOut({ date: D, slot: "cena", compensate: "none", spreadDays: 3, maxChangePct: 15 })).toThrow();
  undo();
  expect(listMeals(D)).toHaveLength(0);
  expect(bySlot("cena").status).toBe("planned");

  ateOut({ date: D, slot: "cena", name: "Tacos al pastor", kcal: 850, protein: 40, compensate: "none", spreadDays: 3, maxChangePct: 15 });
  expect(bySlot("cena").real).toMatchObject({ label: "Tacos al pastor", macros: { kcal: 850, protein: 40 } });
});

test("a meal still pending two hours after its time reads «sin registrar»; skipping it is a choice", () => {
  expect(bySlot("desayuno", at(9, 59)).missed).toBe(false);
  expect(bySlot("desayuno", at(10, 0)).missed).toBe(true);
  expect(bySlot("cena", at(16, 0)).missed).toBe(false);
  skipSlot({ date: D, slot: "desayuno", compensate: "none", spreadDays: 3, maxChangePct: 15 });
  expect(bySlot("desayuno", at(12, 0))).toMatchObject({ status: "skipped", missed: false });
  // Something said to be breakfast after all un-skips it.
  logMeal(food("Chilaquiles", "desayuno", 700, at(11, 0)));
  expect(bySlot("desayuno").status).toBe("replaced");
});

test("backfill: today's real entries, logged before reconciling, land on their meals — once", () => {
  // Exactly as stored: off_plan context, no links, no revisions.
  const raw = (id: string, slot: string, name: string, kcal: number, eatenAt: number, unit = "serving", note: string | null = null) => {
    db()
      .query(`INSERT INTO meal_entries (id, date, eaten_at, slot, name, quantity, unit, kcal, protein, carbs, fat, fiber, source, barcode, plan_item_id)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?, 10, 30, 10, 1, 'agent', NULL, NULL)`)
      .run(id, D, eatenAt, slot, name, unit, kcal);
    db().query("INSERT INTO meal_entry_context (entry_id, off_plan, note) VALUES (?, 1, ?)").run(id, note);
  };
  raw("vuala", "snack", "Vualá Big", 369, at(11, 11), "serving", "Me comí un big vuala");
  raw("tortitas", "comida", "Tortitas de carne de res", 600, at(14, 41), "serving", "5 tortitas... y arroz");
  raw("queso", "comida", "Queso amarillo", 150, at(14, 41), "serving", "5 tortitas... y arroz");
  raw("arroz", "comida", "Arroz blanco", 215, at(14, 41), "serving", "5 tortitas... y arroz");
  raw("coca", "snack", "Coca-Cola Zero", 0, at(14, 51), "ml", "Dos vasos de Coca Zero");
  expect(statuses()).toEqual({ desayuno: "planned", comida: "planned", merienda: "planned", cena: "planned" });

  expect(reconcileBacklog(D)).toBe(2);
  expect(statuses()).toEqual({ desayuno: "replaced", comida: "replaced", merienda: "planned", cena: "planned" });
  expect(bySlot("desayuno").real).toMatchObject({ label: "Vualá Big", entryIds: ["vuala"] });
  expect(bySlot("comida").real).toMatchObject({ label: "Tortitas de carne de res, queso amarillo y arroz blanco", macros: { kcal: 965 } });
  expect(dietDay(activePlan()!, D).extraIds).toEqual(["coca"]);
  expect(listMeals(D).find((e) => e.id === "coca")?.offPlan).toBe(false);

  // Idempotent: nothing new to tie, nothing changes.
  const before = JSON.stringify(slots());
  expect(reconcileBacklog(D)).toBe(0);
  expect(JSON.stringify(slots())).toBe(before);
  expect(listRevisions(activePlan()!.id)).toHaveLength(2);

  // Each tie is undoable on its own.
  undo();
  expect(statuses()).toMatchObject({ desayuno: "replaced", comida: "planned" });
});
