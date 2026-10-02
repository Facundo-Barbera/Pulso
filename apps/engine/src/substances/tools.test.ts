import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { substanceTools } from "./tools";

beforeEach(() => {
  db().exec("DELETE FROM substance_entries; DELETE FROM substance_settings;");
});

test("the Coach logs, lists and deletes through its tools", async () => {
  const byName = new Map(substanceTools.map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown>) => {
    const t = byName.get(name)!;
    const result = await t.handler(args as never, {});
    const text = (result.content[0] as { text: string }).text;
    return { error: result.isError === true, body: result.isError ? null : JSON.parse(text) };
  };
  const logged = await call("log_substance_use", { date: "2026-09-30", time: "22:00", form: "vapeado", amount: "poco" });
  expect(logged.body).toMatchObject({ substance: "cannabis", form: "vapeado", amount: "poco" });
  const listed = await call("list_substance_use", { from: "2026-09-01", to: "2026-10-31" });
  expect(listed.body.uses).toHaveLength(1);
  expect((await call("set_substance_goal", { maxDaysPerWeek: 3 })).body).toEqual({ maxDaysPerWeek: 3 });
  expect((await call("delete_substance_use", { id: logged.body.id })).body).toEqual({ deleted: logged.body.id });
  expect((await call("delete_substance_use", { id: logged.body.id })).error).toBe(true);
});
