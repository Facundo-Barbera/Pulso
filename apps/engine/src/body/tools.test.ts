import { expect, test } from "bun:test";
import { z } from "zod";
import { listGoals, upsertSamples } from "./store";
import { bodyTools } from "./tools";

/** Calls a tool the way the SDK does: arguments validated (defaults applied) by its zod shape. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const t = bodyTools.find((x) => x.name === name)!;
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  const first = result.content[0];
  const body = first?.type === "text" ? first.text : "";
  return { isError: result.isError === true, body, json: () => JSON.parse(body) };
}

test("add_body_scan saves a manual scan and derives the missing fat value", async () => {
  const saved = (await call("add_body_scan", { date: "2026-03-01", weight: 80, percentBodyFat: 20, skeletalMuscleMass: 36 })).json();
  expect(saved).toMatchObject({ source: "manual", weight: 80, bodyFatMass: 16, skeletalMuscleMass: 36 });
  expect(saved.measuredAt).toBe(new Date(2026, 2, 1).getTime());
  const listed = (await call("list_body_scans")).json();
  expect(listed.some((s: { id: string; raw?: unknown }) => s.id === saved.id && !("raw" in s))).toBe(true);
});

test("add_body_scan refuses implausible values and bad dates", async () => {
  expect((await call("add_body_scan", { weight: 180_000 })).isError).toBe(true);
  expect((await call("add_body_scan", { bmi: 24 })).isError).toBe(true);
  expect((await call("add_body_scan", { date: "ayer", weight: 80 })).isError).toBe(true);
});

test("body_projection and set_body_goal", async () => {
  const day = 86_400_000;
  const start = new Date(2026, 4, 1).getTime();
  upsertSamples(Array.from({ length: 21 }, (_, d) => ({ externalId: `hk-pbf-${d}`, metric: "percentBodyFat" as const, value: 30 - 0.05 * d, measuredAt: start + d * day })));

  const what = (await call("body_projection", { metric: "percentBodyFat", target: 25 })).json();
  expect(what.slopePerWeek).toBeCloseTo(-0.35, 2);
  expect(what.goal.message).toContain("llegas a 25% de grasa");
  expect(what.horizons).toHaveLength(3);
  expect(listGoals().find((g) => g.metric === "percentBodyFat")).toBeUndefined();

  const set = (await call("set_body_goal", { metric: "percentBodyFat", target: 25 })).json();
  expect(set.goal.target).toBe(25);
  expect(set.projection.eta).toBeGreaterThan(start);
  expect((await call("set_body_goal", { metric: "percentBodyFat", target: null })).json()).toEqual({ cleared: "percentBodyFat" });
  expect(listGoals().find((g) => g.metric === "percentBodyFat")).toBeUndefined();
});
