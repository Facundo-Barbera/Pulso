import { expect, test } from "bun:test";
import type { Medication } from "@pulso/contract";
import { addDays, computeAdherence, isoWeekday, slotKey, slotTimes, type StatusIndex } from "./schedule";

const med = (over: Partial<Medication> = {}): Medication => ({
  id: "m1",
  name: "Vitamina D",
  kind: "suplemento",
  dose: 1000,
  unit: "UI",
  form: null,
  instructions: null,
  schedule: { asNeeded: false, times: ["08:00", "20:00"], days: [] },
  startDate: "2026-09-01",
  endDate: null,
  stock: null,
  lowStockThreshold: null,
  lowStock: false,
  active: true,
  notes: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

test("date helpers cross month and know weekdays", () => {
  expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(isoWeekday("2026-10-01")).toBe(4); // jueves
  expect(isoWeekday("2026-10-04")).toBe(7); // domingo
});

test("slots follow times, weekdays, date range, as-needed and active", () => {
  expect(slotTimes(med({ schedule: { asNeeded: false, times: ["20:00", "08:00", "08:00"], days: [] } }), "2026-10-01")).toEqual(["08:00", "20:00"]);
  const weekdays = med({ schedule: { asNeeded: false, times: ["09:00"], days: [1, 3, 5] } });
  expect(slotTimes(weekdays, "2026-09-28")).toEqual(["09:00"]); // lunes
  expect(slotTimes(weekdays, "2026-10-01")).toEqual([]); // jueves
  expect(slotTimes(med(), "2026-08-31")).toEqual([]); // before start
  expect(slotTimes(med({ endDate: "2026-09-30" }), "2026-10-01")).toEqual([]);
  expect(slotTimes(med({ endDate: "2026-10-01" }), "2026-10-01")).toHaveLength(2);
  expect(slotTimes(med({ schedule: { asNeeded: true, times: [], days: [] } }), "2026-10-01")).toEqual([]);
  expect(slotTimes(med({ active: false }), "2026-10-01")).toEqual([]);
});

test("adherence counts due slots only and takes early doses", () => {
  const m = med({ startDate: "2026-09-29" }); // 29, 30 full days + today
  const s: StatusIndex = new Map([
    [slotKey("m1", "2026-09-29", "08:00"), "tomada"],
    [slotKey("m1", "2026-09-29", "20:00"), "tomada"],
    [slotKey("m1", "2026-09-30", "08:00"), "omitida"],
    [slotKey("m1", "2026-09-30", "20:00"), "tomada"],
    [slotKey("m1", "2026-10-01", "20:00"), "tomada"], // early
  ]);
  const report = computeAdherence([m], s, "2026-10-01", "12:00");
  // due: 2 + 2 + today's 08:00 (past) + 20:00 (taken early) = 6, taken 4
  expect(report.overall.last7).toEqual({ due: 6, taken: 4, rate: 4 / 6 });
  expect(report.medications[0]?.last30.due).toBe(6);
  expect(report.days).toHaveLength(30);
  expect(report.days.at(-1)).toEqual({ date: "2026-10-01", due: 2, taken: 1 });
  expect(report.days.at(-4)).toEqual({ date: "2026-09-28", due: 0, taken: 0 });
});

test("streaks: today in progress never breaks, empty days are skipped, misses reset", () => {
  const m = med({ startDate: "2026-09-25", schedule: { asNeeded: false, times: ["08:00"], days: [] } });
  const taken = (dates: string[]): StatusIndex => new Map(dates.map((d) => [slotKey("m1", d, "08:00"), "tomada"]));
  // 25, 26 taken; 27 missed; 28, 29, 30 taken; today pending
  let r = computeAdherence([m], taken(["2026-09-25", "2026-09-26", "2026-09-28", "2026-09-29", "2026-09-30"]), "2026-10-01", "09:00");
  expect(r.medications[0]?.currentStreak).toBe(3);
  expect(r.medications[0]?.bestStreak).toBe(3);
  // taking today's dose extends it
  r = computeAdherence([m], taken(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]), "2026-10-01", "09:00");
  expect(r.overall.currentStreak).toBe(4);
  // a weekday-only med doesn't break on its days off
  const mwf = med({ startDate: "2026-09-21", schedule: { asNeeded: false, times: ["08:00"], days: [1, 3, 5] } });
  r = computeAdherence([mwf], taken(["2026-09-21", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-30"]), "2026-10-01", "09:00");
  expect(r.medications[0]?.currentStreak).toBe(5);
});

test("as-needed meds are left out of adherence", () => {
  const prn = med({ id: "prn", schedule: { asNeeded: true, times: [], days: [] } });
  const r = computeAdherence([prn], new Map(), "2026-10-01", "12:00");
  expect(r.medications).toEqual([]);
  expect(r.overall.last30.rate).toBeNull();
});
