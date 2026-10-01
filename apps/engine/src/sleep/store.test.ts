import { expect, test } from "bun:test";
import { z } from "zod";
import { addDays, night } from "./fixtures";
import { listSleepNights, parseSleepInputs, setSleepTargetMin, sleepOverview, sleepSummary, sleepTargetMin, upsertSleepSegments } from "./store";
import { sleepTools } from "./tools";

// One database per test process, so these run as one story in order.
const first = "2030-03-01";
const days = Array.from({ length: 10 }, (_, i) => addDays(first, i));

const call = async (name: string, args: Record<string, unknown>) => {
  const t = sleepTools.find((t) => t.name === name)!;
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  return JSON.parse((result.content[0] as { text: string }).text);
};

test("re-syncing the same nights replaces instead of duplicating", () => {
  expect(upsertSleepSegments(days.flatMap((d) => night(d)))).toEqual(days);
  upsertSleepSegments(days.flatMap((d) => night(d)));
  upsertSleepSegments(night(days[9]!, { core: 300 }));
  const nights = listSleepNights(first, days[9]!);
  expect(nights).toHaveLength(10);
  expect(nights[0]!.minutes.asleep).toBe(300 + 80 + 110);
  expect(nights[1]!.minutes.asleep).toBe(270 + 80 + 110);
});

test("a second source for the same night is kept but the watch wins", () => {
  upsertSleepSegments(night(days[9]!, { source: "iPhone", kind: "phone", core: 500 }));
  const [latest] = listSleepNights(days[9]!, days[9]!);
  expect(latest!.source).toBe("Apple Watch");
});

test("nights in a range are scored against the nights before the range", () => {
  const [latest] = listSleepNights(days[9]!, days[9]!);
  expect(latest!.score.factors.map((f) => f.key)).toContain("consistency");
});

test("target defaults to 8 h and drives the debt", () => {
  expect(sleepTargetMin()).toBe(480);
  expect(sleepSummary(10).debtMin).toBe(9 * 20 - 10); // nine nights 20 min short, the last one 10 min over
  setSleepTargetMin(450);
  expect(sleepSummary(10).debtMin).toBe(0);
  setSleepTargetMin(480);
});

test("overview has nights newest first and a summary", () => {
  const overview = sleepOverview();
  expect(overview.targetMin).toBe(480);
  expect(overview.nights[0]!.night).toBe(days[9]!);
  expect(overview.summary.nights).toBe(10);
  expect(overview.summary.regularity).toBeGreaterThan(90);
});

test("tool handlers", async () => {
  const nights = await call("get_sleep_nights", { from: days[8], to: days[9] });
  expect(nights.map((n: { night: string }) => n.night)).toEqual([days[9], days[8]]);
  expect(nights[0].segments).toBeUndefined();
  const withSegments = await call("get_sleep_nights", { from: days[9], to: days[9], includeSegments: true });
  expect(withSegments[0].segments.length).toBeGreaterThan(0);
  expect((await call("get_sleep_summary", { days: 10 })).nights).toBe(10);
  expect(await call("set_sleep_target", { hours: 7.5 })).toEqual({ targetMin: 450 });
  expect(sleepTargetMin()).toBe(450);
});

test("parseSleepInputs rejects malformed bodies", () => {
  const ok = night(first)[0]!;
  expect(parseSleepInputs({ segments: [ok] })).toHaveLength(1);
  expect(parseSleepInputs({ segments: [{ ...ok, stage: "nap" }] })).toBeUndefined();
  expect(parseSleepInputs({ segments: [{ ...ok, end: ok.start - 1 }] })).toBeUndefined();
  expect(parseSleepInputs({ segments: [{ ...ok, sourceKind: "ring" }] })).toBeUndefined();
  expect(parseSleepInputs({})).toBeUndefined();
});
