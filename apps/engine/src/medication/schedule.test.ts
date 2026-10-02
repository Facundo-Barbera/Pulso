import { expect, test } from "bun:test";
import type { Medication } from "@pulso/contract";
import { addDays, computeAdherence, type DayFacts, isoWeekday, NO_FACTS, resolveSlots, slotKey, type StatusIndex } from "./schedule";

const sched = (over: Partial<Medication["schedule"]> = {}): Medication["schedule"] => ({ asNeeded: false, times: [], days: [], training: null, meals: [], bedtime: false, interval: null, monthDay: null, windows: [], anyTime: false, reminder: null, ...over });
const slotTimes = (m: Medication, date: string) => resolveSlots(m, date).map((s) => s.time);

const med = (over: Partial<Medication> = {}): Medication => ({
  id: "m1",
  name: "Vitamina D",
  kind: "suplemento",
  dose: 1000,
  unit: "UI",
  form: null,
  instructions: null,
  schedule: sched({ asNeeded: false, times: ["08:00", "20:00"], days: [] }),
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
  expect(slotTimes(med({ schedule: sched({ asNeeded: false, times: ["20:00", "08:00", "08:00"], days: [] }) }), "2026-10-01")).toEqual(["08:00", "20:00"]);
  const weekdays = med({ schedule: sched({ asNeeded: false, times: ["09:00"], days: [1, 3, 5] }) });
  expect(slotTimes(weekdays, "2026-09-28")).toEqual(["09:00"]); // lunes
  expect(slotTimes(weekdays, "2026-10-01")).toEqual([]); // jueves
  expect(slotTimes(med(), "2026-08-31")).toEqual([]); // before start
  expect(slotTimes(med({ endDate: "2026-09-30" }), "2026-10-01")).toEqual([]);
  expect(slotTimes(med({ endDate: "2026-10-01" }), "2026-10-01")).toHaveLength(2);
  expect(slotTimes(med({ schedule: sched({ asNeeded: true, times: [], days: [] }) }), "2026-10-01")).toEqual([]);
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
  const m = med({ startDate: "2026-09-25", schedule: sched({ asNeeded: false, times: ["08:00"], days: [] }) });
  const taken = (dates: string[]): StatusIndex => new Map(dates.map((d) => [slotKey("m1", d, "08:00"), "tomada"]));
  // 25, 26 taken; 27 missed; 28, 29, 30 taken; today pending
  let r = computeAdherence([m], taken(["2026-09-25", "2026-09-26", "2026-09-28", "2026-09-29", "2026-09-30"]), "2026-10-01", "09:00");
  expect(r.medications[0]?.currentStreak).toBe(3);
  expect(r.medications[0]?.bestStreak).toBe(3);
  // taking today's dose extends it
  r = computeAdherence([m], taken(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]), "2026-10-01", "09:00");
  expect(r.overall.currentStreak).toBe(4);
  // a weekday-only med doesn't break on its days off
  const mwf = med({ startDate: "2026-09-21", schedule: sched({ asNeeded: false, times: ["08:00"], days: [1, 3, 5] }) });
  r = computeAdherence([mwf], taken(["2026-09-21", "2026-09-23", "2026-09-25", "2026-09-28", "2026-09-30"]), "2026-10-01", "09:00");
  expect(r.medications[0]?.currentStreak).toBe(5);
});

test("as-needed meds are left out of adherence", () => {
  const prn = med({ id: "prn", schedule: sched({ asNeeded: true, times: [], days: [] }) });
  const r = computeAdherence([prn], new Map(), "2026-10-01", "12:00");
  expect(r.medications).toEqual([]);
  expect(r.overall.last30.rate).toBeNull();
});

// ── Moments ─────────────────────────────────────────────────────────────────

const creatina = (restDayTime: string | null = "09:00") =>
  med({ id: "cr", name: "Creatina", dose: 5, unit: "g", schedule: sched({ training: { withinMinutes: 60, restDayTime } }) });
const facts = (over: Partial<DayFacts> = {}): DayFacts => ({ ...NO_FACTS, ...over });
const training = (m: Medication, date: string, f: DayFacts, today = date, now = "12:00") => resolveSlots(m, date, f, today, now).find((s) => s.slot === "entreno");

test("a workout that ended makes it due at its end, within the window", () => {
  const slot = training(creatina(), "2026-10-01", facts({ workoutEnds: ["19:10", "07:40"], planned: [{ start: "18:00", end: "19:00" }] }));
  expect(slot).toEqual({ slot: "entreno", moment: "entreno", time: "07:40", training: { state: "trained", workoutEnd: "07:40", until: "08:40", plannedAt: null, fallback: null }, window: null, remindAt: "07:40" });
  // the window never runs past the day
  expect(training(creatina(), "2026-10-01", facts({ workoutEnds: ["23:30"] }))?.training?.until).toBe("23:59");
});

test("a session in progress or planned later waits; the rest-day time is the fallback", () => {
  const live = training(creatina(), "2026-10-01", facts({ live: true }));
  expect(live?.time).toBeNull();
  expect(live?.training).toMatchObject({ state: "training", fallback: "09:00" });

  const planned = facts({ planned: [{ start: "18:00", end: "19:00" }] });
  const waiting = training(creatina(), "2026-10-01", planned, "2026-10-01", "12:00");
  expect(waiting?.time).toBeNull();
  // waiting past the rest-day time moves the fallback to when the session should have ended
  expect(waiting?.training).toMatchObject({ state: "planned", plannedAt: "18:00", fallback: "19:00" });
  // a future planned day waits too
  expect(training(creatina(), "2026-10-03", planned, "2026-10-01", "12:00")?.training?.state).toBe("planned");
  // with "No tomar" it still waits, with nothing to fall back to
  expect(training(creatina(null), "2026-10-01", planned)?.training).toMatchObject({ state: "planned", fallback: null });
});

test("no workout and none ahead: the rest-day rule", () => {
  expect(training(creatina(), "2026-10-01", facts())).toMatchObject({ time: "09:00", training: { state: "rest", fallback: "09:00" } });
  expect(training(creatina(null), "2026-10-01", facts())).toBeUndefined();
  // a planned session whose end passed without a workout: rest, due once it clearly didn't happen
  const missed = facts({ planned: [{ start: "07:00", end: "08:00" }] });
  expect(training(creatina("07:30"), "2026-10-01", missed, "2026-10-01", "10:00")).toMatchObject({ time: "08:00", training: { state: "rest" } });
  // past days never wait
  expect(training(creatina(), "2026-09-30", facts({ planned: [{ start: "18:00", end: "19:00" }], live: true }), "2026-10-01")).toMatchObject({ time: "19:00", training: { state: "rest" } });
});

test("meal and bedtime slots take the calendar's times, with defaults", () => {
  const m = med({ schedule: sched({ times: ["12:00"], meals: ["cena", "desayuno"], bedtime: true }) });
  const slots = resolveSlots(m, "2026-10-01", facts({ meals: { desayuno: "07:15" }, sleepTime: "23:30" }));
  expect(slots.map((s) => [s.slot, s.moment, s.time])).toEqual([
    ["desayuno", "desayuno", "07:15"],
    ["12:00", "hora", "12:00"],
    ["cena", "cena", "21:00"],
    ["dormir", "dormir", "23:00"],
  ]);
  // a sleep time past midnight reminds before midnight
  expect(resolveSlots(med({ schedule: sched({ bedtime: true }) }), "2026-10-01", facts({ sleepTime: "00:30" }))[0]?.time).toBe("23:30");
});

test("adherence counts moment slots: trained days, rest days, and waiting slots only once due", () => {
  const m = { ...creatina(null), startDate: "2026-09-28" };
  const byDate: Record<string, Partial<DayFacts>> = {
    "2026-09-28": { workoutEnds: ["19:00"] }, // trained, taken
    "2026-09-29": {}, // rest, "No tomar": no slot
    "2026-09-30": { workoutEnds: ["08:00"] }, // trained, missed
    "2026-10-01": { planned: [{ start: "18:00", end: "19:00" }] }, // waiting
  };
  const f = (date: string) => facts(byDate[date] ?? {});
  const s: StatusIndex = new Map([[slotKey("cr", "2026-09-28", "entreno"), "tomada"]]);
  let r = computeAdherence([m], s, "2026-10-01", "12:00", f);
  expect(r.overall.last7).toEqual({ due: 2, taken: 1, rate: 0.5 });
  expect(r.days.at(-3)).toEqual({ date: "2026-09-29", due: 0, taken: 0 });
  expect(r.days.at(-1)).toEqual({ date: "2026-10-01", due: 0, taken: 0 });

  // after today's workout it is due; taking it counts
  const trained = (date: string) => (date === "2026-10-01" ? facts({ workoutEnds: ["19:05"] }) : f(date));
  r = computeAdherence([m], s, "2026-10-01", "19:30", trained);
  expect(r.days.at(-1)).toEqual({ date: "2026-10-01", due: 1, taken: 0 });
  s.set(slotKey("cr", "2026-10-01", "entreno"), "tomada");
  r = computeAdherence([m], s, "2026-10-01", "19:30", trained);
  expect(r.overall.last7).toEqual({ due: 3, taken: 2, rate: 2 / 3 });
  // a rest day without a slot neither counts nor breaks the streak
  expect(r.medications[0]?.currentStreak).toBe(1);
});
