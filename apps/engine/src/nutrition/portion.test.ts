import { expect, test } from "bun:test";
import type { FoodProduct } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { addPantryItems, listPantry } from "../shopping/pantry";
import { usePantry } from "./pantry-use";
import { describeProduct, estimatePortion, PortionError, portionFor } from "./portion";
import { nutritionTools } from "./tools";

const product = (over: Partial<FoodProduct>): FoodProduct => ({
  barcode: "8410000000001",
  name: "Producto",
  brand: null,
  per100g: { kcal: 100, protein: 10, carbs: 10, fat: 1, fiber: 0 },
  servingGrams: null,
  imageUrl: null,
  liquid: false,
  packageSize: null,
  packageKind: null,
  ...over,
});

const peanut = product({ name: "Crema de cacahuete natural", brand: "Hacendado", per100g: { kcal: 588, protein: 25, carbs: 12, fat: 49, fiber: 6 }, packageSize: 350 });
const oats = product({ name: "Copos de avena", per100g: { kcal: 370, protein: 13, carbs: 60, fat: 7, fiber: 10 }, packageSize: 500 });
const cookies = product({ name: "Galletas María", per100g: { kcal: 440, protein: 7, carbs: 72, fat: 13, fiber: 3 }, packageSize: 180 });
const juice = product({ name: "Zumo de naranja", liquid: true, per100g: { kcal: 45, protein: 0.7, carbs: 10, fat: 0, fiber: 0 }, packageSize: 1500, packageKind: "botella" });

test("spoons of a solid weigh by its density: peanut butter is heavier than oats", () => {
  const spoon = estimatePortion(peanut, "una cucharada");
  expect(spoon).toMatchObject({ quantity: 16, unit: "g", measure: { amount: 1, unit: "cucharada", size: 16 } });
  expect(spoon.macros.kcal).toBe(94);
  expect(spoon.assumption).toBe("una cucharada de Crema de cacahuete natural (rasa, ~16 g como crema de cacahuate) ≈ 16 g → 94 kcal");
  expect(spoon.packageShare).toBeCloseTo(16 / 350, 3);

  expect(estimatePortion(oats, "2 cucharadas").quantity).toBe(11);
  expect(estimatePortion(oats, "un cuarto de taza").quantity).toBe(22);
  expect(estimatePortion(oats, "media taza").quantity).toBe(43);
  // Nothing in the table: a typical solid, and it says so.
  const unknown = estimatePortion(product({ name: "Polvo misterioso" }), "1 cucharadita");
  expect(unknown.quantity).toBe(4);
  expect(unknown.assumption).toContain("densidad típica");
});

test("drinks are counted in ml, shares of the bottle by its size", () => {
  expect(estimatePortion(juice, "una cucharada")).toMatchObject({ quantity: 15, unit: "ml" });
  const third = estimatePortion(juice, "un tercio de la botella");
  expect(third).toMatchObject({ quantity: 500, unit: "ml", packageShare: 0.333, measure: { unit: "botella", size: 1500 } });
  expect(third.macros.kcal).toBe(225);
  expect(estimatePortion(juice, "un vaso").quantity).toBe(250);
  expect(estimatePortion(juice, "media botella").quantity).toBe(750);
});

test("shares of the package: words, fractions, counts out of a total and percentages", () => {
  const half = estimatePortion(oats, "la mitad del paquete");
  expect(half).toMatchObject({ quantity: 250, packageShare: 0.5, measure: null });
  expect(estimatePortion(oats, "1/4 del paquete").quantity).toBe(125);
  expect(estimatePortion(cookies, "2 de 6 galletas").quantity).toBe(60);
  expect(estimatePortion(cookies, "dos de las seis").quantity).toBe(60);
  expect(estimatePortion(oats, "el 20%").quantity).toBe(100);
  expect(estimatePortion(oats, "todo el paquete").quantity).toBe(500);
  // Without the package size there is nothing to take a share of.
  expect(() => estimatePortion(product({}), "la mitad")).toThrow(PortionError);
});

test("counted things: the size said, the label's count, else a typical weight; ask when there is none", () => {
  expect(estimatePortion(cookies, "3 galletas")).toMatchObject({ quantity: 30, measure: { amount: 3, unit: "unidad", size: 10 } });
  expect(estimatePortion(cookies, "2 galletas de 11 g").quantity).toBe(22);
  expect(estimatePortion(cookies, "3 galletas", { unitsPerPackage: 24 }).quantity).toBe(23);
  expect(() => estimatePortion(product({}), "3 piezas")).toThrow("¿Cuánto pesa cada pieza");
  expect(estimatePortion(product({ name: "Whey protein", servingGrams: 31 }), "un scoop").quantity).toBe(31);
  expect(estimatePortion(oats, "30 g").quantity).toBe(30);
  expect(estimatePortion(oats, "1,5 cucharadas").quantity).toBe(8.1);
  expect(() => estimatePortion(oats, "un montón")).toThrow(PortionError);
});

test("the model reads a scanned product as label facts", () => {
  const text = describeProduct(peanut.barcode, peanut);
  expect(text).toContain("Name: Crema de cacahuete natural — brand: Hacendado");
  expect(text).toContain("Per 100 g: 588 kcal");
  expect(text).toContain("Package: 350 g");
  expect(text).toContain("~1.07 g/ml (crema de cacahuate)");
  expect(describeProduct("123", null)).toContain("not found");
});

test("the phone's and web's portion call: unreadable → 400, unknown → 404", async () => {
  const found = async () => peanut;
  expect(await portionFor({ barcode: peanut.barcode, amount: "una cucharada" }, found)).toMatchObject({ status: 200, estimate: { quantity: 16 } });
  expect(await portionFor({ barcode: "12", amount: "una cucharada" }, found)).toMatchObject({ status: 400 });
  expect(await portionFor({ barcode: peanut.barcode, amount: "un montón" }, found)).toMatchObject({ status: 400 });
  expect(await portionFor({ barcode: peanut.barcode, amount: "una" }, async () => null)).toMatchObject({ status: 404 });
});

test("the pantry: grams come off the row and it says the share of the package left", () => {
  addPantryItems([{ name: "Crema de cacahuete", quantity: 350, unit: "g" }]);
  expect(usePantry("Crema de cacahuete natural", 52.5, 350)).toMatchObject({ name: "Crema de cacahuete", left: 297.5, leftPct: 85 });
  // Counted in jars: a spoon is a share of one.
  addPantryItems([{ name: "Miel", quantity: 1, unit: "bote" }]);
  expect(usePantry("Miel de flores", 125, 500)).toMatchObject({ left: 0.75, unit: "bote", leftPct: 75 });
  expect(usePantry("Atún en lata", 50, 80)).toBeUndefined();
  // Used up: a plain row goes.
  expect(usePantry("Miel de flores", 400, 500)).toMatchObject({ left: 0 });
  expect(listPantry().some((p) => p.name === "Miel")).toBe(false);
});

async function call(name: string, args: unknown) {
  const t = nutritionTools.find((x) => x.name === name)!;
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const texts = result.content.map((c) => (c as { text: string }).text);
  return { error: result.isError === true, texts, value: result.isError ? undefined : JSON.parse(texts[0]!) };
}

test("estimate_portion → log_meal: logged as said, its grams, and the pantry used up", async () => {
  const code = "8410000000099";
  const jar = { ...peanut, barcode: code, name: "Crema de cacahuete tostado" };
  db().query("INSERT OR REPLACE INTO food_barcode_cache (barcode, product_json, fetched_at) VALUES (?, ?, ?)").run(code, JSON.stringify(jar), Date.now());
  addPantryItems([{ name: "Crema de cacahuete tostado", quantity: 350, unit: "g" }]);

  const estimated = await call("estimate_portion", { barcode: code, amount: "una cucharada" });
  expect(estimated.value.estimate).toMatchObject({ quantity: 16, unit: "g" });
  expect(estimated.value.pantry).toMatchObject({ name: "Crema de cacahuete tostado", quantity: 350 });

  const logged = await call("log_meal", { at: "2032-10-01T17:00", items: [{ ...estimated.value.logItem, slot: "snack" }] });
  expect(logged.value[0]).toMatchObject({ name: "Crema de cacahuete tostado", quantity: 16, unit: "g", kcal: 94, barcode: code, measure: { amount: 1, unit: "cucharada", size: 16 } });
  expect(JSON.parse(logged.texts[1]!)).toEqual({ pantryLeft: [{ name: "Crema de cacahuete tostado", left: 334, unit: "g", leftPct: 95 }] });

  expect((await call("estimate_portion", { barcode: code, amount: "3 piezas" })).error).toBe(true);
  const byLabel = await call("estimate_portion", { product: { name: "Mermelada de fresa", per100g: { kcal: 250, protein: 0, carbs: 60, fat: 0 } }, amount: "una cucharada" });
  expect(byLabel.value.estimate.quantity).toBe(20);
});
