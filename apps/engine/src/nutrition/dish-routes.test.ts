import { expect, test } from "bun:test";
import type { MealEntry, SavedDish } from "@pulso/contract";
import { GET as mobileDishes } from "@/app/api/mobile/nutrition/dishes/route";
import { DELETE as webDeleteDish, PUT as webUpdateDish } from "@/app/api/web/dieta/dishes/[id]/route";
import { POST as webLogSaved } from "@/app/api/web/dieta/dishes/[id]/log/route";
import { GET as webDishes, POST as webSaveDish } from "@/app/api/web/dieta/dishes/route";
import { POST as webLogDish } from "@/app/api/web/dieta/meals/dish/route";
import { PATCH as webPatchDish } from "@/app/api/web/dieta/meals/dish/[id]/route";
import { ownDatabase } from "../web/test-db";

ownDatabase("dish-routes");

const req = (method: string, body?: unknown) =>
  new Request("http://pulso.test/x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const whey = { name: "Proteína whey", measure: "25 g", kcal: 100, protein: 20, carbs: 3, fat: 1.5 };
const milk = { name: "Leche Lala 100 Proteína Light", measure: "500 ml", kcal: 220, protein: 30, carbs: 25, fat: 5 };

test("the phone needs its bearer", async () => {
  expect((await mobileDishes(req("GET"))).status).toBe(401);
});

test("crear platillo, guardar como platillo, log it tweaked, edit and delete it over HTTP", async () => {
  const created = await webLogDish(req("POST", { name: "Batido de proteína", components: [whey, milk], time: "10:00", date: "2036-02-01", slot: "desayuno" }));
  const { meals } = (await created.json()) as { meals: MealEntry[] };
  expect(meals.map((m) => m.dish?.name)).toEqual(["Batido de proteína", "Batido de proteína"]);

  const grown = await webPatchDish(req("PATCH", { add: [{ name: "Fresas", measure: "5 unidades", kcal: 27, protein: 0.5, carbs: 6, fat: 0 }] }), params(meals[0]!.dish!.id));
  expect(((await grown.json()) as { meals: MealEntry[] }).meals).toHaveLength(3);

  const saved = await webSaveDish(req("POST", { loggedDishId: meals[0]!.dish!.id }));
  const { dish } = (await saved.json()) as { dish: SavedDish };
  expect(dish.components).toHaveLength(3);
  expect(dish.slot).toBe("desayuno");

  const logged = await webLogSaved(req("POST", { overrides: [{ component: "leche", measure: "300 ml" }], time: "09:00", date: "2036-02-02" }), params(dish.id));
  const tweaked = ((await logged.json()) as { meals: MealEntry[] }).meals;
  expect(tweaked[1]).toMatchObject({ quantity: 300, kcal: 132, slot: "desayuno" });

  // An amount in the wrong kind of unit is a 400 with the reason.
  const wrong = await webLogSaved(req("POST", { overrides: [{ component: "leche", measure: "30 g" }] }), params(dish.id));
  expect(wrong.status).toBe(400);
  expect(((await wrong.json()) as { detail: string }).detail).toMatch(/counted in ml/);
  expect((await webLogSaved(req("POST", {}), params("nope"))).status).toBe(404);

  const renamed = await webUpdateDish(req("PUT", { name: "Batido de la mañana" }), params(dish.id));
  expect(((await renamed.json()) as { dish: SavedDish }).dish.name).toBe("Batido de la mañana");
  expect((((await (await webDishes()).json()) as { dishes: SavedDish[] }).dishes)[0]!.uses).toBe(2);
  expect((await webDeleteDish(req("DELETE"), params(dish.id))).status).toBe(200);
  expect((await webDeleteDish(req("DELETE"), params(dish.id))).status).toBe(404);
});
