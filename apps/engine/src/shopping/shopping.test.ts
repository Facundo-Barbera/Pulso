import { beforeEach, expect, test } from "bun:test";
import type { DietPlanInput, PlanItem } from "@pulso/contract";
import { db } from "../db";
import { createPlan } from "../nutrition/store";
import { aggregate, buyable, classify, nameKey } from "./aggregate";
import {
  addShoppingItems,
  checkShoppingItems,
  generateShoppingList,
  getShoppingList,
  removeShoppingItems,
  ShoppingError,
  updateShoppingItem,
} from "./store";
import { shoppingTools } from "./tools";

beforeEach(() => {
  db().exec("DELETE FROM shopping_items; DELETE FROM shopping_list; DELETE FROM diet_plans; DELETE FROM pantry_items;");
});

const macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
const item = (name: string, quantity: number, unit: string = "g") => ({ ...macros, name, quantity, unit }) as Omit<PlanItem, "id">;

/** Two alternating days starting 2026-10-01 (day A on odd offsets from it, day B on even). */
const twoDayPlan = (): DietPlanInput => ({
  name: "Definición",
  startsOn: "2026-10-01",
  days: [
    {
      label: "A",
      meals: [
        { slot: "desayuno", items: [item("Huevos", 2, "serving"), item("Leche semidesnatada", 250), item("Avena", 60)] },
        { slot: "comida", items: [item("Pechuga de pollo a la plancha", 200), item("Arroz", 80), item("Tomate", 150)] },
        { slot: "cena", items: [item("Pechugas de pollo", 150), item("Huevo", 120)] },
      ],
    },
    {
      label: "B",
      meals: [
        { slot: "desayuno", items: [item("Leche semidesnatada", 250), item("Avena", 60)] },
        { slot: "comida", items: [item("Salmón", 180), item("Arroz", 80), item("Tomates", 150)] },
        { slot: "cena", items: [item("Garbanzos", 1, "lata"), item("Leche de avena", 1, "taza")] },
      ],
    },
  ],
});

test("names normalize across plurals, accents and how it is cooked", () => {
  expect(nameKey("Pechugas de pollo a la plancha")).toBe(nameKey("pechuga de pollo"));
  expect(nameKey("Limones")).toBe(nameKey("limón"));
  expect(nameKey("Nueces")).toBe(nameKey("nuez"));
  expect(nameKey("Huevos cocidos")).toBe("huevo");
});

test("classifier puts common foods in their aisle", () => {
  expect(classify("Pechuga de pollo")).toBe("carnes_pescados");
  expect(classify("Atún en lata")).toBe("carnes_pescados");
  expect(classify("Aguacate")).toBe("frutas_verduras");
  expect(classify("Agua con gas")).toBe("bebidas");
  expect(classify("Queso fresco batido")).toBe("lacteos_huevos");
  expect(classify("Huevos")).toBe("lacteos_huevos");
  expect(classify("Pan integral")).toBe("panaderia_cereales");
  expect(classify("Crema de cacahuete")).toBe("despensa");
  expect(classify("Guisantes congelados")).toBe("congelados");
  expect(classify("Papel de cocina")).toBe("otros");
});

test("amounts round up to what you'd buy", () => {
  expect(buyable(1330, "g")).toBe("1,4 kg");
  expect(buyable(1400, "g")).toBe("1,4 kg");
  expect(buyable(620, "g")).toBe("650 g");
  expect(buyable(84, "g")).toBe("90 g");
  expect(buyable(1750, "ml")).toBe("2 L");
  expect(buyable(1100, "ml")).toBe("1,5 L");
  expect(buyable(300, "ml")).toBe("300 ml");
  expect(buyable(2.5, "ud")).toBe("3");
  expect(buyable(10, "ud", "huevo")).toBe("12");
  expect(buyable(4, "ud", "huevo")).toBe("4");
  expect(buyable(1, "lata")).toBe("1 lata");
  expect(buyable(2.2, "taza")).toBe("3 tazas");
});

test("aggregates the plan's days in rotation, merging the same ingredient across meals", () => {
  const plan = createPlan(twoDayPlan());
  // From the plan's start, 7 days = A B A B A B A: four A days, three B days.
  const needed = new Map(aggregate(plan, "2026-10-01", 7).map((n) => [n.key, n]));
  const chicken = needed.get("pechuga de pollo|g")!;
  expect(chicken.quantity).toBe(4 * 350);
  expect(chicken.amount).toBe("1,4 kg");
  expect(chicken.name).toBe("Pechugas de pollo");
  expect(chicken.category).toBe("carnes_pescados");
  // 2 eggs + 120 g (two eggs) per A day → 16, bought by the half dozen.
  expect(needed.get("huevo|ud")).toMatchObject({ quantity: 16, amount: "18", category: "lacteos_huevos" });
  // Milk is counted in grams by the plan but bought by volume.
  expect(needed.get("leche semidesnatada|ml")).toMatchObject({ quantity: 1750, amount: "2 L" });
  expect(needed.get("tomate|g")).toMatchObject({ quantity: 1050, amount: "1,1 kg", category: "frutas_verduras" });
  expect(needed.get("arroz|g")!.amount).toBe("600 g");
  // Units it can't convert stay as their own line.
  expect(needed.get("garbanzo|lata")).toMatchObject({ quantity: 3, amount: "3 latas", category: "despensa" });
  expect(needed.get("leche de avena|taza")!.amount).toBe("3 tazas");

  // Starting a day later shifts the rotation: B A B → one fewer A day in 3 days.
  expect(new Map(aggregate(plan, "2026-10-02", 3).map((n) => [n.key, n])).get("pechuga de pollo|g")!.quantity).toBe(350);
});

test("tolerates units it has never seen and odd quantities", () => {
  const needed = aggregate(
    {
      startsOn: "2026-10-01",
      days: [{ label: "", meals: [{ slot: "comida", name: null, items: [{ ...item("Aceite de oliva", 2, "cucharadas"), id: "1" }, { ...item("Sal", 0), id: "2" }, { ...item("Leche", 0.5, "l"), id: "3" }] }] }],
    },
    "2026-10-01",
    2,
  );
  expect(needed.map((n) => [n.key, n.amount])).toEqual([
    ["aceite de oliva|cucharada", "4 cucharadas"],
    ["leche|ml", "1 L"],
  ]);
});

test("needs an active plan to generate", () => {
  expect(() => generateShoppingList({})).toThrow(ShoppingError);
  expect(getShoppingList()).toMatchObject({ hasPlan: false, items: [], done: 0, total: 0 });
});

test("regenerating keeps manual items and marks of ingredients still needed", () => {
  createPlan(twoDayPlan());
  let list = generateShoppingList({ days: 7, from: "2026-10-01" });
  expect(list).toMatchObject({ from: "2026-10-01", to: "2026-10-07", days: 7, planName: "Definición", stale: false, hasPlan: true });
  const byName = (name: string) => list.items.find((i) => i.name === name)!;

  const chicken = byName("Pechugas de pollo");
  const salmon = byName("Salmón");
  const rice = byName("Arroz");
  list = checkShoppingItems([chicken.id]);
  list = updateShoppingItem(rice.id, { pantry: true });
  list = updateShoppingItem(salmon.id, { category: "congelados" });
  // The phone sends nulls for empty fields: an automatic aisle and no amount.
  list = addShoppingItems([{ name: "Papel de cocina", amount: null, category: null }, { name: "Café", amount: "1 paquete" }]);
  expect(list.items.find((i) => i.name === "Café")).toMatchObject({ category: "bebidas", source: "manual", amount: "1 paquete" });
  const total = list.total;
  expect(list.done).toBe(1);

  // A new plan with only day A: salmon is no longer needed, chicken is (with a new amount).
  const next = twoDayPlan();
  next.name = "Volumen";
  next.days = [next.days[0]!];
  createPlan(next);
  expect(getShoppingList().stale).toBe(true);
  list = generateShoppingList({ days: 3, from: "2026-10-01" });

  const names = list.items.map((i) => i.name);
  expect(names).toContain("Papel de cocina");
  expect(names).toContain("Café");
  expect(names).not.toContain("Salmón");
  expect(list.items.find((i) => i.id === chicken.id)).toMatchObject({ checked: true, amount: "1,1 kg" });
  expect(list.items.find((i) => i.id === rice.id)).toMatchObject({ pantry: true, checked: false });
  expect(list).toMatchObject({ planName: "Volumen", days: 3, stale: false, done: 1 });
  expect(list.total).toBeLessThan(total);
});

test("bought and 'ya tengo' exclude each other; pantry doesn't count", () => {
  createPlan(twoDayPlan());
  const list = generateShoppingList({ days: 1, from: "2026-10-01" });
  const [first] = list.items;
  expect(checkShoppingItems([first!.id]).done).toBe(1);
  const after = updateShoppingItem(first!.id, { pantry: true });
  expect(after.items.find((i) => i.id === first!.id)).toMatchObject({ pantry: true, checked: false });
  expect(after.done).toBe(0);
  expect(after.total).toBe(list.total - 1);
});

test("an unknown id changes nothing", () => {
  createPlan(twoDayPlan());
  const list = generateShoppingList({ days: 1, from: "2026-10-01" });
  expect(() => checkShoppingItems([list.items[0]!.id, "nope"])).toThrow(ShoppingError);
  expect(getShoppingList().done).toBe(0);
  expect(() => removeShoppingItems([list.items[0]!.id, "nope"])).toThrow(ShoppingError);
  expect(getShoppingList().items).toHaveLength(list.items.length);
  expect(() => updateShoppingItem("nope", { checked: true })).toThrow(ShoppingError);
});

test("the share text lists what's left to buy by aisle", () => {
  createPlan(twoDayPlan());
  const list = generateShoppingList({ days: 1, from: "2026-10-01" });
  const rice = list.items.find((i) => i.name === "Arroz")!;
  const text = checkShoppingItems([rice.id]).text;
  expect(text.startsWith("Lista de compras (1 oct – 1 oct)")).toBe(true);
  expect(text).toContain("Carnes y pescados\n• Pechugas de pollo — 350 g");
  expect(text).toContain("Lácteos y huevos\n");
  expect(text).not.toContain("Arroz");
  expect(text.indexOf("Frutas y verduras")).toBeLessThan(text.indexOf("Carnes y pescados"));
});

test("the tools work end to end and report errors to the model", async () => {
  const call = (name: string, args: unknown) => shoppingTools.find((t) => t.name === name)!.handler(args as never, {});
  const failed = await call("generate_shopping_list", { days: 7 });
  expect(failed.isError).toBe(true);
  createPlan(twoDayPlan());
  const made = await call("generate_shopping_list", { days: 3, from: "2026-10-01" });
  const list = JSON.parse((made.content[0] as { text: string }).text);
  expect(list.items.length).toBeGreaterThan(0);
  const added = await call("add_shopping_items", { items: [{ name: "Bolsas de basura" }] });
  expect((added.content[0] as { text: string }).text).toContain("Bolsas de basura");
});
