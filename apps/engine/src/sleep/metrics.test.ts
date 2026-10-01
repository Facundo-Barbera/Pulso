import { describe, expect, test } from "bun:test";
import type { SleepSegmentInput } from "@pulso/contract";
import { addDays, at, night, TZ } from "./fixtures";
import { buildNight, buildNights, describeNights, formatDuration, nightOf, regularity, scoreNight, summarize, type StoredSegment } from "./metrics";

const stored = (segs: SleepSegmentInput[]): StoredSegment[] => segs.map((s) => ({ ...s, night: nightOf(s.start, s.tzOffsetMin) }));
const nights = (first: string, count: number, shape: (i: number) => Parameters<typeof night>[1] = () => ({})) =>
  buildNights(stored(Array.from({ length: count }, (_, i) => night(addDays(first, i), shape(i))).flat()));

describe("nightOf", () => {
  test("names a night after the local day you wake up, 18:00 → 18:00", () => {
    expect(nightOf(at("2026-01-02", -60), TZ)).toBe("2026-01-02"); // 23:00 the evening before
    expect(nightOf(at("2026-01-02", 60), TZ)).toBe("2026-01-02"); // 01:00
    expect(nightOf(at("2026-01-02", 14 * 60), TZ)).toBe("2026-01-02"); // nap at 14:00
    expect(nightOf(at("2026-01-02", 19 * 60), TZ)).toBe("2026-01-03"); // 19:00 belongs to the next night
  });
});

describe("buildNight", () => {
  test("totals, efficiency, stage shares and local clock times", () => {
    const n = buildNight("2026-01-02", stored(night("2026-01-02", { bed: -60, core: 240, deep: 90, rem: 120, awake: 30 })))!;
    expect(n.minutes).toEqual({ inBed: 480, asleep: 450, awake: 30, core: 240, deep: 90, rem: 120, unspecified: 0 });
    expect(n.efficiency).toBeCloseTo(450 / 480);
    expect(n.stagePct!.deep).toBeCloseTo(0.2);
    expect(n.bedtimeMin).toBe(-60);
    expect(n.wakeMin).toBe(-60 + 10 + 450);
  });

  test("prefers Apple Watch over the iPhone and never adds the two", () => {
    const phone: SleepSegmentInput = { start: at("2026-01-02", -90), end: at("2026-01-02", 480), stage: "asleep", source: "iPhone", sourceKind: "phone", tzOffsetMin: TZ };
    const n = buildNight("2026-01-02", stored([phone, ...night("2026-01-02", { source: "Watch" })]))!;
    expect(n.source).toBe("Watch");
    expect(n.minutes.asleep).toBe(270 + 80 + 110);
  });

  test("without a watch, a source with stages wins, then the one that saw more sleep", () => {
    const a: SleepSegmentInput = { start: at("2026-01-02", -60), end: at("2026-01-02", 420), stage: "asleep", source: "A", sourceKind: "other", tzOffsetMin: TZ };
    const b = { ...a, source: "B", end: at("2026-01-02", 300) };
    expect(buildNight("2026-01-02", stored([a, b]))!.source).toBe("A");
    expect(buildNight("2026-01-02", stored([a, ...night("2026-01-02", { source: "Oura", kind: "other", core: 60 })]))!.source).toBe("Oura");
  });

  test("an in-bed-only night is not a night", () => {
    const inBed: SleepSegmentInput = { start: at("2026-01-02", -60), end: at("2026-01-02", 420), stage: "inBed", source: "iPhone", sourceKind: "phone", tzOffsetMin: TZ };
    expect(buildNight("2026-01-02", stored([inBed]))).toBeUndefined();
  });
});

describe("scoreNight", () => {
  test("a full, efficient, regular night scores high", () => {
    const all = nights("2026-01-01", 5, () => ({ core: 280, deep: 90, rem: 120 }));
    const score = scoreNight(all.at(-1)!, all.slice(0, -1), 480);
    expect(score.value).toBeGreaterThanOrEqual(90);
    expect(score.factors.map((f) => f.key)).toEqual(["duration", "efficiency", "restoration", "consistency"]);
    expect(score.explanation).toStartWith("Buena noche");
  });

  test("a short night is explained by its duration", () => {
    const [n] = nights("2026-01-01", 1, () => ({ core: 200, deep: 60, rem: 70 }));
    const score = scoreNight(n!, [], 480);
    expect(score.value).toBeLessThan(70);
    expect(score.explanation).toBe("Dormiste 5 h 30 min, 2 h 30 min menos que tu objetivo.");
  });

  test("leaves out factors it cannot measure and rescales", () => {
    const plain: SleepSegmentInput = { start: at("2026-01-02", -60), end: at("2026-01-02", 420), stage: "asleep", source: "A", sourceKind: "other", tzOffsetMin: TZ };
    const score = scoreNight(buildNight("2026-01-02", stored([plain]))!, [], 480);
    expect(score.factors.map((f) => f.key)).toEqual(["duration", "efficiency"]);
    expect(score.value).toBe(100);
  });
});

describe("describeNights", () => {
  test("says how much later you went to bed than your average", () => {
    const all = describeNights(nights("2026-01-01", 8, (i) => ({ bed: i === 7 ? -12 : -60 })), 480);
    expect(all[0]!.night).toBe("2026-01-08");
    expect(all[0]!.insights).toContain("Te acostaste 48 min más tarde que tu promedio.");
    expect(all[1]!.insights).toEqual([]);
  });

  test("celebrates reaching the target", () => {
    const [n] = describeNights(nights("2026-01-01", 1, () => ({ core: 300 })), 480);
    expect(n!.insights).toEqual(["Llegaste a tu objetivo de 8 h."]);
  });
});

describe("summary", () => {
  test("debt is the shortfall against the target over the window, never negative", () => {
    const short = describeNights(nights("2026-01-01", 14, () => ({ core: 230, deep: 80, rem: 110 })), 480); // 7 h
    expect(summarize(short, 480).debtMin).toBe(14 * 60);
    const long = describeNights(nights("2026-01-01", 14, () => ({ core: 330, deep: 80, rem: 110 })), 480); // 8 h 40 min
    expect(summarize(long, 480).debtMin).toBe(0);
    expect(summarize(short, 480).insights[0]).toBe("Llevas 14 h de deuda de sueño en las últimas 14 noches.");
  });

  test("only the last 14 days count", () => {
    const all = describeNights(nights("2026-01-01", 30), 480);
    const s = summarize(all, 480);
    expect([s.nights, s.from, s.to]).toEqual([14, "2026-01-17", "2026-01-30"]);
  });

  test("bedtime and wake spread", () => {
    const all = describeNights(nights("2026-01-01", 4, (i) => ({ bed: i % 2 ? -120 : 0 })), 480);
    const s = summarize(all, 480);
    expect(s.avgBedtimeMin).toBe(-60);
    expect(s.bedtimeSdMin).toBe(60);
    expect(s.wakeSdMin).toBe(60);
  });

  test("empty", () => {
    expect(summarize([], 480)).toMatchObject({ nights: 0, debtMin: 0, regularity: null, insights: [] });
  });
});

describe("regularity", () => {
  test("identical nights are perfectly regular; shifting every other night by 3 h is not", () => {
    expect(regularity(nights("2026-01-01", 7))).toBe(100);
    const shifted = regularity(nights("2026-01-01", 7, (i) => ({ bed: i % 2 ? 120 : -60 })))!;
    expect(shifted).toBeLessThan(80);
    expect(shifted).toBeGreaterThan(0);
  });

  test("needs two consecutive nights", () => {
    expect(regularity(nights("2026-01-01", 1))).toBeNull();
    expect(regularity([...nights("2026-01-01", 1), ...nights("2026-01-03", 1)])).toBeNull();
  });
});

test("formatDuration", () => {
  expect([formatDuration(45), formatDuration(480), formatDuration(450), formatDuration(-48)]).toEqual(["45 min", "8 h", "7 h 30 min", "48 min"]);
});

describe("one source holding the same minute twice", () => {
  const seg = (stage: SleepSegmentInput["stage"], from: number, to: number): SleepSegmentInput => ({ start: at("2026-01-02", from), end: at("2026-01-02", to), stage, source: "Watch", sourceKind: "watch", tzOffsetMin: TZ });

  test("a sample written twice counts once", () => {
    const n = buildNight("2026-01-02", stored([seg("core", 0, 120), seg("core", 0, 120), seg("awake", 120, 130), seg("awake", 120, 130)]))!;
    expect(n.minutes).toMatchObject({ core: 120, awake: 10, asleep: 120 });
  });

  test("unspecified sleep under staged sleep adds only the time the stages don't cover", () => {
    const n = buildNight("2026-01-02", stored([seg("asleep", 0, 300), seg("deep", 0, 60), seg("core", 60, 200), seg("rem", 200, 240)]))!;
    expect(n.minutes).toMatchObject({ deep: 60, core: 140, rem: 40, unspecified: 60, asleep: 300 });
    expect(n.segments.reduce((a, s) => a + s.end - s.start, 0)).toBe(300 * 60_000);
  });

  test("overlapping stages from one source keep the earlier one's minutes", () => {
    const n = buildNight("2026-01-02", stored([seg("core", 0, 100), seg("deep", 90, 150)]))!;
    expect(n.minutes).toMatchObject({ core: 100, deep: 50, asleep: 150 });
  });
});
