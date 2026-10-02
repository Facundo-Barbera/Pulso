import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { migrateSubstances } from "./schema";
import { substanceTools } from "./tools";

beforeEach(() => {
  db().exec("DELETE FROM substance_entries; DELETE FROM substances;");
  migrateSubstances(db());
});

const byName = new Map(substanceTools.map((t) => [t.name, t]));
async function call(name: string, args: Record<string, unknown>) {
  const result = await byName.get(name)!.handler(args as never, {});
  const text = (result.content[0] as { text: string }).text;
  return { error: result.isError === true, text, body: result.isError ? null : JSON.parse(text) };
}

test("the Coach logs by name, lists, sets a goal and deletes through its tools", async () => {
  const logged = await call("log_substance_use", { substance: "cannabis", date: "2026-09-30", time: "22:00", form: "vapeado", amount: "poco" });
  expect(logged.body).toMatchObject({ substanceId: "cannabis", form: "vapeado", amount: "poco" });
  expect((await call("log_substance_use", { substance: "Alcohol", date: "2026-09-30", time: "21:00", quantity: 2 })).body).toMatchObject({ substanceId: "alcohol", quantity: 2 });
  expect((await call("list_substance_use", { from: "2026-09-01", to: "2026-10-31", substance: "Cannabis" })).body.uses).toHaveLength(1);
  expect((await call("set_substance_goal", { substance: "Alcohol", maxDaysPerWeek: 2 })).body).toMatchObject({ id: "alcohol", maxDaysPerWeek: 2 });
  expect((await call("substance_summary", {})).body.substanceId).toBeNull();
  expect((await call("substance_summary", { substance: "alcohol" })).body.goal.maxDaysPerWeek).toBe(2);
  expect((await call("delete_substance_use", { id: logged.body.id })).body).toEqual({ deleted: logged.body.id });
  expect((await call("delete_substance_use", { id: logged.body.id })).error).toBe(true);
});

test("an unknown substance is an error naming the ones that exist, until the person asks to create it", async () => {
  const unknown = await call("log_substance_use", { substance: "Tabaco" });
  expect(unknown.error).toBe(true);
  expect(unknown.text).toContain("Cannabis, Alcohol");
  const created = await call("create_substance", { name: "Tabaco", unit: "cigarros", forms: ["fumado"] });
  expect(created.body).toMatchObject({ name: "Tabaco", unit: "cigarros", forms: ["fumado"] });
  expect((await call("log_substance_use", { substance: "tabaco", quantity: 1 })).body).toMatchObject({ substanceId: created.body.id, form: "fumado" });
  expect((await call("list_substances", {})).body.substances.map((s: { name: string }) => s.name)).toEqual(["Cannabis", "Alcohol", "Tabaco"]);
});
