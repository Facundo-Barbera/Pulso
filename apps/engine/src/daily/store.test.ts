import { expect, test } from "bun:test";
import { listDailyMetrics, parseDailyInputs, readinessFor, upsertDailyMetrics } from "./store";
import { dailyTools } from "./tools";

const input = (date: string, m: Record<string, number | null> = {}) => parseDailyInputs({ days: [{ date, ...m }] })![0]!;

test("upsert by date keeps fields a later partial sync left null", () => {
  upsertDailyMetrics([input("2026-01-10", { steps: 4000, hrv: 48 })], 1);
  upsertDailyMetrics([input("2026-01-10", { steps: 9000, sleepMinutes: 450 })], 2);
  const [stored, ...rest] = listDailyMetrics("2026-01-10", "2026-01-10");
  expect(rest).toHaveLength(0);
  expect(stored).toMatchObject({ steps: 9000, hrv: 48, sleepMinutes: 450, vo2max: null, updatedAt: 2 });
});

test("list is inclusive and oldest first", () => {
  upsertDailyMetrics(["2026-02-03", "2026-02-01", "2026-02-02", "2026-02-04"].map((d) => input(d, { steps: 1 })));
  expect(listDailyMetrics("2026-02-01", "2026-02-03").map((d) => d.date)).toEqual(["2026-02-01", "2026-02-02", "2026-02-03"]);
});

test("parseDailyInputs rejects malformed bodies", () => {
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", steps: 10, hrv: null }] })).toHaveLength(1);
  expect(parseDailyInputs({ days: [{ date: "2026-02-30" }] })).toBeUndefined();
  expect(parseDailyInputs({ days: [{ date: "01/02/2026" }] })).toBeUndefined();
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", steps: "many" }] })).toBeUndefined();
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", steps: -1 }] })).toBeUndefined();
  expect(parseDailyInputs({})).toBeUndefined();
});

test("readinessFor reads the baseline from the store", () => {
  const days = Array.from({ length: 10 }, (_, i) => input(`2026-04-${String(i + 1).padStart(2, "0")}`, { hrv: 50, restingHeartRate: 55 }));
  upsertDailyMetrics([...days, input("2026-04-11", { hrv: 50, restingHeartRate: 55, sleepMinutes: 480 })]);
  const r = readinessFor("2026-04-11");
  expect(r.baselineDays).toBe(10);
  expect(r.factors.every((f) => f.score !== null)).toBe(true);
});

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await dailyTools.find((t) => t.name === name)!.handler(args as never, undefined);
  return { ...result, json: JSON.parse((result.content[0] as { text: string }).text) };
};

test("get_daily_metrics returns the range and refuses bad ranges", async () => {
  upsertDailyMetrics([input("2026-05-01", { steps: 100 }), input("2026-05-02", { steps: 200 })]);
  expect((await call("get_daily_metrics", { from: "2026-05-01", to: "2026-05-02" })).json.map((d: { steps: number }) => d.steps)).toEqual([100, 200]);
  expect((await call("get_daily_metrics", { to: "2026-05-02" })).json).toHaveLength(2);
  expect((await call("get_daily_metrics", { from: "2026-05-03", to: "2026-05-02" })).isError).toBe(true);
  expect((await call("get_daily_metrics", { from: "2025-01-01", to: "2026-05-02" })).isError).toBe(true);
});

test("get_readiness returns the score for a date", async () => {
  upsertDailyMetrics([input("2026-06-01", { sleepMinutes: 480 })]);
  const { json } = await call("get_readiness", { date: "2026-06-01" });
  expect(json).toMatchObject({ date: "2026-06-01", score: 100, level: "high" });
});
