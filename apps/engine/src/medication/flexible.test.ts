import { expect, test } from "bun:test";
import type { Medication, MedicationSchedule } from "@pulso/contract";
import { ownDatabase } from "../web/test-db";
import { db } from "../db";
import { computeAdherence, isDueOn, resolveSlots, slotKey, type StatusIndex } from "./schedule";
import { adherence, getMedication, logDose, medicationDay, parseSchedule, updateMedication, upcomingSlots } from "./store";
import { medicationTools } from "./tools";

// 2034-06-01 is a Thursday.
ownDatabase("medication-flexible");
const THU = "2034-06-01";

const sched = (over: Partial<MedicationSchedule> = {}): MedicationSchedule => ({
  asNeeded: false,
  times: [],
  days: [],
  interval: null,
  monthDay: null,
  training: null,
  meals: [],
  bedtime: false,
  windows: [],
  anyTime: false,
  reminder: null,
  ...over,
});
const med = (schedule: MedicationSchedule, startDate = "2034-01-01"): Medication => ({
  id: "m",
  name: "Semaglutida",
  kind: "medicamento",
  dose: 1,
  unit: "mg",
  form: null,
  instructions: null,
  schedule,
  startDate,
  endDate: null,
  stock: null,
  lowStockThreshold: null,
  lowStock: false,
  active: true,
  notes: null,
  createdAt: 0,
  updatedAt: 0,
});

test("any time: one slot due all day, no clock time, reminded at its chosen hour", () => {
  const sema = med(sched({ days: [4], anyTime: true, reminder: "19:00" }));
  expect(resolveSlots(sema, THU)).toEqual([{ slot: "dia", moment: "dia", time: null, training: null, window: null, remindAt: "19:00" }]);
  expect(resolveSlots(sema, "2034-06-02")).toEqual([]);
  expect(resolveSlots(med(sched({ anyTime: true, reminder: null })), THU)[0]!.remindAt).toBeNull();
});

test("day-part windows: due from their start to their end, any-time slots sort last", () => {
  const slots = resolveSlots(med(sched({ anyTime: true, windows: [{ part: "noche", start: "20:00", end: "23:30" }, { part: "manana", start: "07:00", end: "12:00" }], times: ["09:00"] })), THU);
  expect(slots.map((s) => [s.slot, s.time, s.window && `${s.window.start}-${s.window.end}`, s.remindAt])).toEqual([
    ["manana", "07:00", "07:00-12:00", "07:00"],
    ["09:00", "09:00", null, "09:00"],
    ["noche", "20:00", "20:00-23:30", "20:00"],
    ["dia", null, null, null],
  ]);
});

test("frequency: every N days, every N weeks on a weekday, and a day of the month (clamped)", () => {
  const every3 = sched({ interval: { every: 3, unit: "day", start: "2034-06-01" } });
  expect(["2034-05-29", "2034-06-01", "2034-06-02", "2034-06-04", "2034-06-07"].map((d) => isDueOn(every3, d))).toEqual([false, true, false, true, true]);

  // Every 2 weeks on Thursday from a Saturday: the start's week is a due week, but its Thursday came before the start.
  const fortnight = sched({ days: [4], interval: { every: 2, unit: "week", start: "2034-05-27" } });
  expect(["2034-05-25", "2034-06-01", "2034-06-08", "2034-06-15", "2034-06-22"].map((d) => isDueOn(fortnight, d))).toEqual([false, false, true, false, true]);

  const on31 = sched({ monthDay: 31 });
  expect(["2034-05-31", "2034-06-30", "2034-06-29", "2034-02-28", "2034-07-31"].map((d) => isDueOn(on31, d))).toEqual([true, true, false, true, true]);
  expect(isDueOn(sched({ monthDay: 1 }), THU)).toBe(true);
});

test("adherence: any-time and window slots are missed only once their day is over; weekly meds count per due day", () => {
  const sema = med(sched({ days: [4], anyTime: true, reminder: "19:00" }), "2034-05-01");
  const none: StatusIndex = new Map();
  // Thursday 23:00, not taken yet: nothing is due today.
  let r = computeAdherence([sema], none, THU, "23:00");
  expect(r.days.at(-1)).toEqual({ date: THU, due: 0, taken: 0 });
  // Friday: Thursday's dose is now missed. Four Thursdays in May + this one = 5 due in 30 days.
  r = computeAdherence([sema], none, "2034-06-02", "08:00");
  expect(r.days.at(-2)).toEqual({ date: THU, due: 1, taken: 0 });
  expect(r.medications[0]!.last30).toEqual({ due: 5, taken: 0, rate: 0 });
  // Taken on Thursday at any hour counts right away.
  const taken: StatusIndex = new Map([[slotKey("m", THU, "dia"), "tomada"]]);
  expect(computeAdherence([sema], taken, THU, "06:00").days.at(-1)).toEqual({ date: THU, due: 1, taken: 1 });

  const morning = med(sched({ windows: [{ part: "manana", start: "07:00", end: "12:00" }] }), THU);
  expect(computeAdherence([morning], none, THU, "15:00").days.at(-1)).toEqual({ date: THU, due: 0, taken: 0 });
  expect(computeAdherence([morning], none, "2034-06-02", "06:00").days.at(-2)).toEqual({ date: THU, due: 1, taken: 0 });
});

test("normalizing: defaults for the reminder, windows and interval; one frequency kept", () => {
  expect(parseSchedule({ asNeeded: false, times: [], days: [4], anyTime: true }, THU)).toMatchObject({ anyTime: true, reminder: "19:00", days: [4] });
  expect(parseSchedule({ asNeeded: false, times: [], days: [4], anyTime: true, reminder: null }, THU).reminder).toBeNull();
  expect(parseSchedule({ asNeeded: false, times: ["08:00"], days: [], reminder: "10:00" }, THU).reminder).toBeNull();
  expect(parseSchedule({ asNeeded: false, times: [], days: [], windows: [{ part: "tarde" }] as never }, THU).windows).toEqual([{ part: "tarde", start: "12:00", end: "19:00" }]);
  expect(parseSchedule({ asNeeded: false, times: ["08:00"], days: [], interval: { every: 2, unit: "week" } }, THU)).toMatchObject({ interval: { every: 2, unit: "week", start: THU }, days: [4] });
  expect(parseSchedule({ asNeeded: false, times: ["08:00"], days: [1, 2], interval: { every: 3, unit: "day" } }, THU)).toMatchObject({ interval: { every: 3, unit: "day", start: THU }, days: [] });
  expect(parseSchedule({ asNeeded: false, times: ["08:00"], days: [1], interval: { every: 1, unit: "day" } }, THU)).toMatchObject({ interval: null, days: [] });
  expect(parseSchedule({ asNeeded: false, times: ["08:00"], days: [1], monthDay: 15, interval: { every: 2, unit: "week" } }, THU)).toMatchObject({ monthDay: 15, interval: null, days: [] });
  expect(() => parseSchedule({ asNeeded: false, times: [], days: [], windows: [{ part: "manana", start: "12:00", end: "08:00" }] }, THU)).toThrow();
  expect(() => parseSchedule({ asNeeded: false, times: [], days: [], windows: [{ part: "manana" }, { part: "manana" }] as never }, THU)).toThrow();
});

test("migration: schedules stored before these options read the same, every time, without rewriting", () => {
  const stored = '{"asNeeded":false,"times":["08:00"],"days":[4],"training":null,"meals":["cena"],"bedtime":false}';
  db()
    .query(
      `INSERT INTO medications (id, name, kind, dose, unit, schedule, start_date, active, created_at, updated_at)
       VALUES ('legacy', 'Hierro', 'suplemento', 1, 'comprimido', ?, '2034-01-01', 1, 0, 0)`,
    )
    .run(stored);
  const first = getMedication("legacy").schedule;
  expect(first).toEqual(sched({ times: ["08:00"], days: [4], meals: ["cena"] }));
  expect(getMedication("legacy").schedule).toEqual(first);
  expect(db().query<{ schedule: string }, []>("SELECT schedule FROM medications WHERE id = 'legacy'").get()!.schedule).toBe(stored);
  expect(medicationDay(THU, "07:00").slots.map((s) => [s.slot, s.moment, s.remindAt])).toEqual([
    ["08:00", "hora", "08:00"],
    ["cena", "cena", "21:00"],
  ]);
  db().query("DELETE FROM medications WHERE id = 'legacy'").run();
});

test("semaglutida, Thursdays at any time: today, logging, the next one and the reminders", async () => {
  const handler = medicationTools.find((t) => t.name === "add_medication")!.handler as (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }>;
  const added = JSON.parse(
    (await handler({ name: "Semaglutida", dose: 1, unit: "mg", form: "pluma", startDate: "2034-05-01", schedule: { asNeeded: false, times: [], days: [4], anyTime: true } }, {})).content[0]!.text,
  ) as Medication;
  expect(added.schedule).toMatchObject({ days: [4], anyTime: true, reminder: "19:00", times: [] });

  const today = medicationDay(THU, "10:00");
  expect(today.slots).toHaveLength(1);
  expect(today.slots[0]).toMatchObject({ slot: "dia", moment: "dia", time: null, remindAt: "19:00", status: "pendiente" });
  expect(today.next).toBeNull();

  // Reminders for the next week: this Thursday and the next, at 19:00.
  const upcoming = upcomingSlots(THU, "10:00", 8).slots.filter((s) => s.medicationId === added.id);
  expect(upcoming.map((s) => [s.date, s.slot, s.remindAt])).toEqual([
    [THU, "dia", "19:00"],
    ["2034-06-08", "dia", "19:00"],
  ]);

  logDose({ medicationId: added.id, date: THU, scheduledTime: "dia", status: "tomada", takenAt: Date.now() });
  expect(medicationDay(THU, "10:00").slots[0]!.status).toBe("tomada");
  expect(adherence(THU, "10:00").medications.find((m) => m.medicationId === added.id)!.last7).toEqual({ due: 1, taken: 1, rate: 1 });

  // A window still open is `next`; once it closes, it isn't.
  const morning = updateMedication(added.id, { schedule: { asNeeded: false, times: [], days: [], windows: [{ part: "manana", start: "08:00", end: "11:00" }] } });
  expect(morning.schedule).toMatchObject({ anyTime: false, reminder: null, windows: [{ part: "manana", start: "08:00", end: "11:00" }] });
  expect(medicationDay("2034-06-02", "10:30").next).toMatchObject({ slot: "manana", time: "08:00", window: { start: "08:00", end: "11:00" } });
  expect(medicationDay("2034-06-02", "11:30").next).toBeNull();

  // The reminder can be turned off.
  const quiet = updateMedication(added.id, { schedule: { asNeeded: false, times: [], days: [4], anyTime: true, reminder: null } });
  expect(medicationDay(THU, "10:00").slots.find((s) => s.medicationId === quiet.id)!.remindAt).toBeNull();
});
