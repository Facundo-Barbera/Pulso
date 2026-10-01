import { expect, test } from "bun:test";
import { addBusyBlock, addHealthEvent, insertPlanned, writePlanned } from "../calendar/store";
import { addDays, isoWeekday } from "../calendar/time";
import { calendarPage, weekStrip } from "./calendar";
import { ownDatabase } from "./test-db";

ownDatabase("web-calendar");

// Wednesday 2034-03-15, 10:00 local.
const WED = "2034-03-15";
const MON = "2034-03-13";
const NOW = new Date(2034, 2, 15, 10, 0);

test("the week runs Monday to Sunday around the chosen day, with each item under its date", () => {
  expect(isoWeekday(MON)).toBe(1);
  const block = addBusyBlock({ title: "Viaje", date: WED, start: "15:00", end: "18:00" });
  addHealthEvent({ kind: "lesion", title: "Tobillo", bodyArea: "ankle", startDate: addDays(WED, -1) }, WED);

  const page = calendarPage({}, NOW);
  expect(page).toMatchObject({ view: "semana", today: WED, day: WED, from: MON, to: addDays(MON, 6) });
  expect(page.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(MON, i)));
  const wed = page.days.find((d) => d.date === WED)!;
  expect(wed.items.map((i) => i.kind).sort()).toEqual(["busy", "health"]);
  expect(page.busyBlocks.map((b) => b.id)).toEqual([block.id]);
  expect(page.healthEvents.map((e) => e.title)).toEqual(["Tobillo"]);
  // An ongoing event runs through today, not into the future.
  expect(page.days.find((d) => d.date === addDays(WED, 1))!.items).toEqual([]);
});

test("the month covers six whole weeks from the Monday on or before the 1st; «salud» draws no days", () => {
  const month = calendarPage({ view: "mes", day: "2034-03-20" }, NOW);
  expect(month.from).toBe("2034-02-27");
  expect(month.days).toHaveLength(42);
  expect(month.days.at(-1)!.date).toBe("2034-04-09");

  const health = calendarPage({ view: "salud" }, NOW);
  expect(health.days).toEqual([]);
  expect(health.healthEvents).toHaveLength(1);
});

test("unknown views and malformed days fall back to the week and today", () => {
  expect(calendarPage({ view: "año", day: "mañana" }, NOW)).toMatchObject({ view: "semana", day: WED });
});

test("planned sessions still clashing show up as conflicts", () => {
  const plan = insertPlanned({ programId: null, dayId: null, name: "Torso A", date: addDays(WED, 2), time: "18:00", durationMin: 60, reason: null });
  writePlanned(plan.id, { conflict: "Ocupado: Viaje" });
  expect(calendarPage({}, NOW).conflicts.map((c) => [c.name, c.conflict])).toEqual([["Torso A", "Ocupado: Viaje"]]);
});

test("the week strip lists what is still ahead today and tomorrow", () => {
  addBusyBlock({ title: "Dentista", date: WED, start: "08:00", end: "09:00" });
  const strip = weekStrip(NOW);
  expect(strip.today).toBe(WED);
  expect(strip.days).toHaveLength(7);
  // The 08:00 block is over; the all-day injury and the 15:00 trip are not. Friday's session is too far.
  expect(strip.upcoming.map((i) => i.title)).toEqual(["Tobillo", "Viaje"]);
});
