import { describe, expect, test } from "bun:test";
import { dailyMedians, fitTrend, goalEta, project } from "./projection";

const DAY = 86_400_000;
const T0 = new Date(2026, 0, 1, 8).getTime();

/** `days` daily readings on a line `start + slope × day`, with a fixed ±noise zig-zag. */
const line = (days: number, start: number, slope: number, noise = 0) =>
  Array.from({ length: days }, (_, d) => ({ at: T0 + d * DAY, value: start + slope * d + (d % 2 ? noise : -noise) }));

describe("fitTrend", () => {
  test("recovers a known slope and level", () => {
    const trend = fitTrend(line(60, 90, -0.1, 0.3))!;
    expect(trend.slope).toBeCloseTo(-0.1, 2);
    expect(trend.level).toBeCloseTo(90 - 0.1 * 59, 0);
  });

  test("an outlier barely moves it", () => {
    const points = line(30, 80, -0.05);
    points[15] = { ...points[15]!, value: 95 };
    expect(fitTrend(points)!.slope).toBeCloseTo(-0.05, 3);
  });

  test("the band widens with the horizon and holds the line", () => {
    const trend = fitTrend(line(40, 70, 0.02, 0.4))!;
    const near = trend.at(28);
    const far = trend.at(84);
    expect(far.high - far.low).toBeGreaterThan(near.high - near.low);
    expect(near.low).toBeLessThan(near.value);
    expect(near.high).toBeGreaterThan(near.value);
  });

  test("needs 3 days spanning a week", () => {
    expect(fitTrend(line(2, 80, 0))).toBeNull();
    expect(fitTrend(line(5, 80, 0))).toBeNull();
    expect(fitTrend(line(8, 80, 0))).not.toBeNull();
  });
});

test("dailyMedians collapses same-day readings", () => {
  const points = [
    { at: T0, value: 80 },
    { at: T0 + 3_600_000, value: 81 },
    { at: T0 + 7_200_000, value: 90 },
    { at: T0 + DAY, value: 79 },
  ];
  expect(dailyMedians(points).map((p) => p.value)).toEqual([81, 79]);
});

describe("goalEta", () => {
  const trend = fitTrend(line(30, 30, -0.1))!; // 30% → 27.1% at the last day, −0.1 points/day

  test("dates the crossing", () => {
    const { eta, message } = goalEta("percentBodyFat", trend, 25, T0);
    expect(eta).toBe(trend.lastAt + 21 * DAY);
    expect(message).toMatch(/^A este ritmo llegas a 25% de grasa alrededor del \d+ \p{L}+\.$/u);
  });

  test("says so when moving away, when reached, and when too far", () => {
    expect(goalEta("percentBodyFat", trend, 35, T0)).toEqual({ eta: null, message: "A este ritmo no te acercas a 35% de grasa." });
    expect(goalEta("percentBodyFat", trend, 27.1, T0).message).toBe("Ya estás en tu objetivo de 27,1% de grasa.");
    expect(goalEta("percentBodyFat", fitTrend(line(30, 30, -0.001))!, 25, T0).message).toContain("más de dos años");
  });
});

test("project: horizons at 4/8/12 weeks, goal, and a note", () => {
  const p = project("weight", line(90, 100, -0.1, 0.2), { metric: "weight", target: 85, setAt: T0 }, T0);
  expect(p.horizons.map((h) => h.weeks)).toEqual([4, 8, 12]);
  expect(p.horizons[0]!.value).toBeCloseTo(p.current! - 2.8, 1);
  expect(p.slopePerWeek).toBeCloseTo(-0.7, 2);
  expect(p.goal?.eta).toBeGreaterThan(p.observed.at(-1)!.at);
  expect(p.note).toBe("Bajando 0,7 kg por semana.");
  expect(p.band.at(-1)!.at).toBe(p.horizons[2]!.at);
});

test("project: only the last 120 days steer the trend", () => {
  const old = line(60, 120, 0.2).map((p) => ({ ...p, at: p.at - 400 * DAY }));
  const p = project("weight", [...old, ...line(30, 90, -0.1)]);
  expect(p.observed).toHaveLength(30);
  expect(p.slopePerWeek).toBeCloseTo(-0.7, 2);
});

test("project: too little data says why", () => {
  const p = project("skeletalMuscleMass", line(2, 35, 0));
  expect(p.current).toBeNull();
  expect(p.horizons).toEqual([]);
  expect(p.note).toContain("al menos 3 mediciones");
});
