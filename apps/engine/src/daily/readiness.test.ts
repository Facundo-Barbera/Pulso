import type { DailyMetrics } from "@pulso/contract";
import { expect, test } from "bun:test";
import { addDays } from "./dates";
import { computeReadiness, ESTIMATE_WEIGHT, hoursMinutes } from "./readiness";

const DATE = "2026-03-29";
const blank: Omit<DailyMetrics, "date"> = {
  steps: null, activeEnergy: null, exerciseMinutes: null, exerciseMinutesEstimated: false, restingHeartRate: null,
  restingHeartRateEstimated: false, hrv: null, sleepMinutes: null,
  sleepDeep: null, sleepCore: null, sleepRem: null, sleepAwake: null, vo2max: null, respiratoryRate: null, updatedAt: 0,
};
const day = (date: string, m: Partial<DailyMetrics>): DailyMetrics => ({ ...blank, date, ...m });

/** 28 days before DATE with HRV alternating 45/55 ms (mean 50) and resting HR 54/56 bpm (mean 55). */
const baseline = Array.from({ length: 28 }, (_, i) =>
  day(addDays(DATE, -(i + 1)), { hrv: i % 2 ? 45 : 55, restingHeartRate: i % 2 ? 54 : 56 }),
);

const factor = (r: ReturnType<typeof computeReadiness>, key: string) => r.factors.find((f) => f.key === key)!;

test("a day at baseline with a full night scores high", () => {
  const r = computeReadiness(DATE, day(DATE, { hrv: 50, restingHeartRate: 55, sleepMinutes: 480 }), baseline);
  expect(factor(r, "sleep").score).toBe(100);
  expect(factor(r, "hrv").score).toBeGreaterThanOrEqual(68);
  expect(factor(r, "resting_hr").score).toBe(70);
  expect(r.score).toBeGreaterThanOrEqual(75);
  expect(r.level).toBe("high");
  expect(r.baselineDays).toBe(28);
  expect(r.explanation).toStartWith("Buena recuperación");
});

test("low HRV, high resting HR and a short night score low and say why", () => {
  const r = computeReadiness(DATE, day(DATE, { hrv: 30, restingHeartRate: 64, sleepMinutes: 300 }), baseline);
  expect(factor(r, "hrv").score).toBe(0);
  expect(factor(r, "resting_hr").score).toBe(0);
  expect(factor(r, "sleep").score).toBe(40);
  expect(r.level).toBe("low");
  expect(r.explanation).toContain("Recuperación baja");
  expect(factor(r, "hrv").detail).toBe("40% por debajo de tu media");
  expect(factor(r, "resting_hr").detail).toBe("9 lpm por encima de tu media");
});

test("higher HRV and lower resting HR than usual score above baseline", () => {
  const r = computeReadiness(DATE, day(DATE, { hrv: 60, restingHeartRate: 52 }), baseline);
  expect(factor(r, "hrv").score).toBeGreaterThan(80);
  expect(factor(r, "resting_hr").score).toBe(100);
  // No sleep: the score is the weighted mean of the two that exist.
  expect(factor(r, "sleep").score).toBeNull();
  expect(r.score).toBeGreaterThan(85);
});

test("without enough baseline only sleep counts", () => {
  const r = computeReadiness(DATE, day(DATE, { hrv: 50, restingHeartRate: 55, sleepMinutes: 420 }), baseline.slice(0, 3));
  expect(factor(r, "hrv").score).toBeNull();
  expect(factor(r, "hrv").detail).toBe("Armando tu media (3/5 días)");
  expect(r.score).toBe(80);
  expect(r.level).toBe("high");
});

test("days outside the 28-day window and the day itself are not baseline", () => {
  const old = Array.from({ length: 10 }, (_, i) => day(addDays(DATE, -(40 + i)), { hrv: 200 }));
  const r = computeReadiness(DATE, day(DATE, { hrv: 50 }), [...old, day(DATE, { hrv: 50 })]);
  expect(factor(r, "hrv").baseline).toBeNull();
  expect(r.baselineDays).toBe(0);
});

test("an estimated resting heart rate weighs ESTIMATE_WEIGHT of a measured one", () => {
  const today = { hrv: 50, restingHeartRate: 64, sleepMinutes: 480 };
  const measured = computeReadiness(DATE, day(DATE, today), baseline);
  const estimated = computeReadiness(DATE, day(DATE, { ...today, restingHeartRateEstimated: true }), baseline);
  const [hrv, resting, sleep] = estimated.factors.map((f) => f.score!);
  expect(resting).toBe(0);
  const weights = { hrv: 0.4, resting: 0.3 * ESTIMATE_WEIGHT, sleep: 0.3 };
  expect(estimated.score).toBe(Math.round((hrv! * weights.hrv + resting! * weights.resting + sleep! * weights.sleep) / (weights.hrv + weights.resting + weights.sleep)));
  // The same bad resting HR drags the score down less when it is only an estimate.
  expect(estimated.score!).toBeGreaterThan(measured.score!);
  expect(factor(estimated, "resting_hr")).toMatchObject({ estimated: true, detail: "9 lpm por encima de tu media (estimado)" });
  expect(factor(measured, "resting_hr").estimated).toBe(false);
  expect(factor(estimated, "hrv").estimated).toBe(false);
});

test("an estimate is not flagged when there is no resting heart rate", () => {
  const r = computeReadiness(DATE, day(DATE, { restingHeartRateEstimated: true, sleepMinutes: 480 }), baseline);
  expect(factor(r, "resting_hr").estimated).toBe(false);
});

test("no data at all is unknown, not zero", () => {
  const r = computeReadiness(DATE, undefined, []);
  expect(r.score).toBeNull();
  expect(r.level).toBe("unknown");
  expect(r.explanation).toContain("Todavía no hay datos");
});

test("durations round the total first, matching the apps' formatting", () => {
  expect(hoursMinutes(379.6)).toBe("6 h 20 min");
  expect(hoursMinutes(59.6)).toBe("1 h");
  expect(hoursMinutes(480)).toBe("8 h");
});
