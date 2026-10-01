import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { db } from "../db";
import { mealSchema, toMealInput } from "./inputs";
import { parseMeasure, toQuantity } from "./measure";
import { NUTRITION_SCHEMA } from "./schema";
import { dailySummary, frequentFoods, listMeals, logMeal } from "./store";

const parsed = (text: string) => {
  const p = parseMeasure(text);
  return p && { amount: p.measure.amount, unit: p.measure.unit, size: p.measure.size, quantity: p.quantity, as: p.unit };
};

test("household units convert with their default sizes", () => {
  expect(parsed("2 latas")).toEqual({ amount: 2, unit: "lata", size: null, quantity: 710, as: "ml" });
  expect(parsed("1 taza")).toEqual({ amount: 1, unit: "taza", size: null, quantity: 240, as: "ml" });
  expect(parsed("un vaso")).toEqual({ amount: 1, unit: "vaso", size: null, quantity: 250, as: "ml" });
  expect(parsed("media taza")?.quantity).toBe(120);
  expect(parsed("una y media botellas")?.quantity).toBe(750);
  expect(parsed("2 cucharadas")?.quantity).toBe(30);
  expect(parsed("1 cdta")?.quantity).toBe(5);
  expect(parsed("un puño")).toEqual({ amount: 1, unit: "puño", size: null, quantity: 30, as: "g" });
  expect(parsed("1/2 puñado")?.quantity).toBe(15);
});

test("an explicit size overrides the default, in its own unit", () => {
  expect(parsed("una lata de 330 ml")).toEqual({ amount: 1, unit: "lata", size: 330, quantity: 330, as: "ml" });
  expect(parsed("1 botella (1,5 l)")).toEqual({ amount: 1, unit: "botella", size: 1500, quantity: 1500, as: "ml" });
  expect(parsed("1 taza de 40 g")).toEqual({ amount: 1, unit: "taza", size: 40, quantity: 40, as: "g" });
});

test("plain weights and volumes, with metric prefixes", () => {
  expect(parsed("30 g de almendras")).toEqual({ amount: 30, unit: "g", size: null, quantity: 30, as: "g" });
  expect(parsed("250ml")).toEqual({ amount: 250, unit: "ml", size: null, quantity: 250, as: "ml" });
  expect(parsed("33 cl")?.quantity).toBe(330);
  expect(parsed("1,5 litros")?.quantity).toBe(1500);
  expect(parsed("0.2 kg")?.quantity).toBe(200);
  expect(parsed("2 porciones")).toEqual({ amount: 2, unit: "serving", size: null, quantity: 2, as: "serving" });
});

test("counts of named things are servings, or grams/ml with a size", () => {
  expect(parsed("2 galletas")).toEqual({ amount: 2, unit: "unidad", size: null, quantity: 2, as: "serving" });
  expect(parsed("2 galletas de 11 g")).toEqual({ amount: 2, unit: "unidad", size: 11, quantity: 22, as: "g" });
  expect(parsed("un café con leche 250 ml")).toEqual({ amount: 1, unit: "unidad", size: 250, quantity: 250, as: "ml" });
  expect(parsed("una cerveza 330 ml")?.as).toBe("ml");
});

test("text without an amount or a unit is not a measure", () => {
  expect(parseMeasure("café")).toBeNull();
  expect(parseMeasure("")).toBeNull();
  expect(parseMeasure("0 latas")).toBeNull();
});

test("toQuantity keeps g, ml and serving as they are", () => {
  expect(toQuantity({ amount: 180, unit: "g", size: null })).toEqual({ quantity: 180, unit: "g" });
  expect(toQuantity({ amount: 2, unit: "serving", size: 99 })).toEqual({ quantity: 2, unit: "serving" });
  expect(toQuantity({ amount: 3, unit: "unidad", size: 11 })).toEqual({ quantity: 33, unit: "g" });
});

test("toMealInput takes a measure in words or as an object, else quantity + unit", () => {
  const base = { name: "Coca-Cola", slot: "snack", kcal: 139, protein: 0, carbs: 35, fat: 0 };
  const words = toMealInput(mealSchema.parse({ ...base, measure: "una lata" }));
  expect(words).toMatchObject({ quantity: 355, unit: "ml", measure: { amount: 1, unit: "lata", size: null } });
  const object = toMealInput(mealSchema.parse({ ...base, measure: { amount: 2, unit: "lata", size: 330 }, quantity: 1 }));
  expect(object).toMatchObject({ quantity: 660, unit: "ml", measure: { amount: 2, unit: "lata", size: 330 } });
  // A size on g/ml means nothing and is dropped.
  expect(toMealInput(mealSchema.parse({ ...base, measure: { amount: 200, unit: "ml", size: 5 } }))).toMatchObject({ measure: { size: null } });
  expect(toMealInput(mealSchema.parse({ ...base, quantity: 40 }))).toMatchObject({ quantity: 40, unit: "g" });
  expect(typeof toMealInput(mealSchema.parse(base))).toBe("string");
  expect(typeof toMealInput(mealSchema.parse({ ...base, measure: "algo" }))).toBe("string");
});

test("entries keep the measure as said, caffeine and alcohol; the summary adds them up", () => {
  const coffee = logMeal({
    name: "Café con leche", slot: "snack", quantity: 240, unit: "ml", kcal: 90, protein: 5, carbs: 7, fat: 4, fiber: 0,
    measure: { amount: 1, unit: "taza", size: null }, caffeineMg: 80, date: "2033-02-01",
  });
  logMeal({
    name: "Cerveza", slot: "snack", quantity: 660, unit: "ml", kcal: 280, protein: 2, carbs: 22, fat: 0, fiber: 0,
    measure: { amount: 2, unit: "lata", size: 330 }, alcoholG: 26, date: "2033-02-01",
  });
  logMeal({ name: "Manzana", slot: "snack", quantity: 1, unit: "serving", kcal: 80, protein: 0, carbs: 20, fat: 0, fiber: 3, date: "2033-02-01" });
  const [first, second, apple] = listMeals("2033-02-01");
  expect(first).toMatchObject({ id: coffee.id, unit: "ml", measure: { amount: 1, unit: "taza", size: null }, caffeineMg: 80, alcoholG: null });
  expect(second).toMatchObject({ measure: { amount: 2, unit: "lata", size: 330 }, alcoholG: 26 });
  expect(apple).toMatchObject({ measure: null, caffeineMg: null, alcoholG: null });
  const summary = dailySummary("2033-02-01");
  expect(summary).toMatchObject({ caffeineMg: 80, alcoholG: 26, entries: 3 });
  expect(summary.bySlot.snack?.kcal).toBe(450);
});

test("frequent snacks keep drinks and snacks only, with their measure", () => {
  const today = "2033-03-10";
  logMeal({ name: "Pollo", slot: "comida", quantity: 150, unit: "g", kcal: 250, protein: 46, carbs: 0, fat: 5, fiber: 0, date: today });
  logMeal({
    name: "Coca-Cola Zero", slot: "comida", quantity: 355, unit: "ml", kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: 0,
    measure: { amount: 1, unit: "lata", size: null }, caffeineMg: 34, date: today,
  });
  const names = frequentFoods(50, today, true).map((f) => f.name);
  expect(names).toContain("Coca-Cola Zero");
  expect(names).not.toContain("Pollo");
  const cola = frequentFoods(50, today, true).find((f) => f.name === "Coca-Cola Zero");
  expect(cola).toMatchObject({ measure: { amount: 1, unit: "lata" }, caffeineMg: 34 });
});

test("the schema upgrades a database from before measures, idempotently", () => {
  const old = new Database(":memory:");
  old.exec(`CREATE TABLE meal_entries (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, eaten_at INTEGER NOT NULL, slot TEXT NOT NULL, name TEXT NOT NULL,
    quantity REAL NOT NULL, unit TEXT NOT NULL, kcal REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL,
    fat REAL NOT NULL, fiber REAL NOT NULL, source TEXT NOT NULL, barcode TEXT, plan_item_id TEXT)`);
  old.exec(`INSERT INTO meal_entries VALUES ('old', '2020-01-01', 1, 'snack', 'Leche', 200, 'g', 120, 6, 10, 6, 0, 'manual', NULL, NULL)`);
  old.exec(NUTRITION_SCHEMA);
  old.exec(NUTRITION_SCHEMA);
  const row = old
    .query("SELECT m.unit, d.measure_unit FROM meal_entries m LEFT JOIN meal_entry_detail d ON d.entry_id = m.id WHERE m.id = 'old'")
    .get();
  expect(row).toEqual({ unit: "g", measure_unit: null });
});

test("rows logged before measures read back unchanged", () => {
  db().exec(`INSERT INTO meal_entries (id, date, eaten_at, slot, name, quantity, unit, kcal, protein, carbs, fat, fiber, source)
    VALUES ('legacy', '2033-04-01', 1, 'merienda', 'Yogur', 1, 'serving', 100, 10, 8, 3, 0, 'manual')`);
  expect(listMeals("2033-04-01")[0]).toMatchObject({ unit: "serving", quantity: 1, measure: null, caffeineMg: null, alcoholG: null });
});
