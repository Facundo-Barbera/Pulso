import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { DAILY_SCHEMA, migrateDaily } from "./schema";
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

test("estimated flags travel with their value", () => {
  const date = "2026-01-20";
  const flagged = (m: Record<string, number | boolean | null>) => parseDailyInputs({ days: [{ date, ...m }] })![0]!;
  const stored = () => listDailyMetrics(date, date)[0]!;

  upsertDailyMetrics([flagged({ restingHeartRate: 52, restingHeartRateEstimated: true, exerciseMinutes: 40, exerciseMinutesEstimated: true })]);
  expect(stored()).toMatchObject({ restingHeartRate: 52, restingHeartRateEstimated: true, exerciseMinutes: 40, exerciseMinutesEstimated: true });

  // A sync without those values keeps both the numbers and their flags.
  upsertDailyMetrics([flagged({ steps: 1000 })]);
  expect(stored()).toMatchObject({ restingHeartRate: 52, restingHeartRateEstimated: true, exerciseMinutes: 40, exerciseMinutesEstimated: true });

  // Health's own value arrives later (flag absent = false) and replaces the estimate.
  upsertDailyMetrics([flagged({ restingHeartRate: 58 })]);
  expect(stored()).toMatchObject({ restingHeartRate: 58, restingHeartRateEstimated: false, exerciseMinutesEstimated: true });
});

test("parseDailyInputs defaults the flags to false, ignores a flag without a value, rejects non-booleans", () => {
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", restingHeartRate: 50 }] })![0]).toMatchObject({ restingHeartRateEstimated: false, exerciseMinutesEstimated: false });
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", exerciseMinutesEstimated: true }] })![0]!.exerciseMinutesEstimated).toBe(false);
  expect(parseDailyInputs({ days: [{ date: "2026-01-01", restingHeartRate: 50, restingHeartRateEstimated: "yes" }] })).toBeUndefined();
});

test("migrateDaily adds the flag columns once and keeps existing rows", () => {
  const old = new Database(":memory:");
  old.exec(DAILY_SCHEMA);
  old.exec("INSERT INTO daily_metrics (date, resting_heart_rate, updated_at) VALUES ('2026-01-01', 55, 1)");
  migrateDaily(old);
  migrateDaily(old);
  const row = old.query<Record<string, number>, []>("SELECT * FROM daily_metrics").get()!;
  expect(row).toMatchObject({ resting_heart_rate: 55, resting_heart_rate_estimated: 0, exercise_minutes_estimated: 0 });
  expect(old.query<{ name: string }, []>("PRAGMA table_info(daily_metrics)").all().filter((c) => c.name.endsWith("_estimated"))).toHaveLength(2);
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
