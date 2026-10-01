import { expect, test } from "bun:test";
import type { DietHorizon, PlanChange } from "@pulso/contract";
import { GET as mobileHorizon } from "@/app/api/mobile/nutrition/horizon/route";
import { POST as webOps } from "@/app/api/web/dieta/plan/ops/route";
import { GET as webRevisions } from "@/app/api/web/dieta/plan/revisions/route";
import { POST as webUndo } from "@/app/api/web/dieta/plan/revisions/undo/route";
import { GET as webHorizon } from "@/app/api/web/dieta/horizon/route";
import { POST as webRecipe } from "@/app/api/web/dieta/recipes/route";
import { GET as webPreps } from "@/app/api/web/dieta/preps/route";
import { gate } from "../tailnet-gate";
import { ownDatabase } from "../web/test-db";
import { createPlan } from "./store";

ownDatabase("plan-routes");

const req = (url: string, init: RequestInit = {}) => new Request(`http://pulso.test${url}`, { ...init, headers: { "content-type": "application/json" } });
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body) });
const item = (name: string, kcal: number) => ({ name, quantity: 100, unit: "g" as const, kcal, protein: 10, carbs: 10, fat: 5, fiber: 0 });

test("the phone needs its bearer; a viewing browser reads the plan but can't change it", async () => {
  expect((await mobileHorizon(req("/api/mobile/nutrition/horizon"))).status).toBe(401);
  const viewer = { scopes: ["view" as const] };
  expect(gate({ method: "GET", pathname: "/api/web/dieta/horizon", device: viewer }).allow).toBe(true);
  expect(gate({ method: "POST", pathname: "/api/web/dieta/plan/ops", device: viewer }).allow).toBe(false);
});

test("horizon, ops, revisions, undo, recipes and preps over HTTP", async () => {
  expect(await (await webHorizon(req("/api/web/dieta/horizon"))).json()).toEqual({ horizon: null });
  expect((await webOps(post("/x", { op: "skip", slot: "cena" }))).status).toBe(409);

  createPlan({ name: "Plan", startsOn: "2035-01-01", days: [{ label: "Día", meals: [{ slot: "desayuno", items: [item("Avena", 400)] }, { slot: "cena", items: [item("Salmón", 600)] }] }] });
  const res = await webHorizon(req("/api/web/dieta/horizon?from=2035-01-01&days=3"));
  const { horizon } = (await res.json()) as { horizon: DietHorizon };
  expect(horizon.days.map((d) => d.slots.length)).toEqual([2, 2, 2]);
  expect((await webHorizon(req("/api/web/dieta/horizon?days=90"))).status).toBe(400);

  // An op with a bad body is a 400; one that doesn't fit the plan a 409 with the engine's reason.
  expect((await webOps(post("/x", { op: "fly" }))).status).toBe(400);
  const conflict = await webOps(post("/x", { op: "skip", date: "2035-01-01", slot: "comida" }));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: "plan_conflict", detail: expect.stringContaining("no comida") });

  const skipped = (await (await webOps(post("/x", { op: "skip", date: "2035-01-01", slot: "cena" }))).json()) as PlanChange;
  expect(skipped.summary).toBe("Saltaste cena del lun 1 (−600 kcal).");
  const { revisions } = await (await webRevisions(req("/api/web/dieta/plan/revisions"))).json();
  expect(revisions[0]).toMatchObject({ op: "skip", undoneAt: null });
  const undone = (await (await webUndo(post("/x", {}))).json()) as PlanChange;
  expect(undone.summary).toStartWith("Deshecho");
  expect((await webUndo(post("/x", {}))).status).toBe(409);

  const recipe = await webRecipe(post("/x", { name: "Lentejas", servings: 4, prepMinutes: 40, batch: true, ingredients: [{ ...item("Lentejas", 1400), quantity: 400 }] }));
  const { recipe: saved } = await recipe.json();
  expect(saved.perServing.kcal).toBe(350);
  await webOps(post("/x", { op: "schedule_prep", recipeId: saved.id, cookDate: "2035-01-01", portions: 4, assign: [{ date: "2035-01-02", slot: "comida" }] }));
  const { preps } = await (await webPreps()).json();
  expect(preps[0]).toMatchObject({ recipeName: "Lentejas", leftover: 3 });
});
