import { expect, test } from "bun:test";
import type { DoseEvent, Medication } from "@pulso/contract";
import { scheduleNudges } from "./nudges";
import { addDays, isoWeekday } from "./schedule";

const TODAY = "2033-07-14"; // a Thursday

const med = (name: string, over: Partial<Medication> = {}): Medication => ({
  id: name,
  name,
  kind: "medicamento",
  dose: 1,
  unit: "comprimido",
  form: null,
  instructions: null,
  schedule: { asNeeded: true, times: [], days: [], training: null, meals: [], bedtime: false, interval: null, monthDay: null, windows: [], anyTime: false, reminder: null },
  startDate: "2033-01-01",
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

let n = 0;
/** A taken as-needed intake at local `time` on `date`. */
const taken = (medicationId: string, date: string, time: string): DoseEvent => ({
  id: String(n++),
  medicationId,
  date,
  scheduledTime: null,
  status: "tomada",
  takenAt: new Date(`${date}T${time}:00`).getTime(),
  loggedAt: 0,
});

test("known drugs: levotiroxina daily en ayunas at the usual time; injectable semaglutide weekly on its usual day", () => {
  const events = [taken("Levotiroxina", TODAY, "09:56"), taken("Levotiroxina", addDays(TODAY, -1), "09:40")];
  const sundays = [-4, -11].map((d) => taken("Semaglutida", addDays(TODAY, d), "10:10"));
  const nudges = scheduleNudges([med("Levotiroxina"), med("Semaglutida", { unit: "inyección" }), med("Rybelsus semaglutida")], [...events, ...sundays], TODAY);

  expect(nudges.map((x) => [x.name, x.cadence, x.reason])).toEqual([
    ["Levotiroxina", "daily", "known"],
    ["Semaglutida", "weekly", "known"],
  ]);
  expect(nudges[0]).toMatchObject({ title: "Levotiroxina parece diaria. ¿Ponerle horario?", detail: "En ayunas al despertar · 09:50", instructions: "en ayunas" });
  expect(nudges[0]!.schedule).toEqual({ asNeeded: false, times: ["09:50"], days: [], training: null, meals: [], bedtime: false, interval: null, monthDay: null, windows: [], anyTime: false, reminder: null });
  expect(isoWeekday(addDays(TODAY, -4))).toBe(7);
  expect(nudges[1]).toMatchObject({ detail: "Semanal · domingo · cualquier hora", schedule: { times: [], days: [7], anyTime: true, reminder: "19:00" } });
});

test("semaglutide logged on Thursdays is proposed as weekly on Thursday, any time", () => {
  const thursdays = [0, -7, -14].map((d, i) => taken("Semaglutida", addDays(TODAY, d), ["08:10", "21:40", "13:00"][i]!));
  const [nudge] = scheduleNudges([med("Semaglutida", { unit: "mg", form: "pluma" })], thursdays, TODAY);
  expect(nudge).toMatchObject({ cadence: "weekly", title: "Semaglutida parece semanal. ¿Ponerle horario?", detail: "Semanal · jueves · cualquier hora" });
  expect(nudge!.schedule).toEqual({ asNeeded: false, times: [], days: [4], interval: null, monthDay: null, training: null, meals: [], bedtime: false, windows: [], anyTime: true, reminder: "19:00" });
});

test("known drugs with nothing logged fall back to a sensible time and today's weekday; existing instructions stay", () => {
  const [levo, sema] = scheduleNudges([med("Eutirox", { instructions: "con agua" }), med("Ozempic", { unit: "inyección" })], [], TODAY);
  expect(levo).toMatchObject({ detail: "En ayunas al despertar · 07:30", instructions: null });
  expect(sema!.schedule.days).toEqual([isoWeekday(TODAY)]);
});

test("patterns: daily when logged most days near the same time, weekly when a week apart; otherwise nothing", () => {
  const daily = [0, -1, -2, -4, -5].map((d, i) => taken("Vitamina D", addDays(TODAY, d), ["08:10", "08:30", "07:50", "08:20", "08:00"][i]!));
  const scattered = [0, -1, -2, -3, -4].map((d, i) => taken("Ibuprofeno", addDays(TODAY, d), ["08:00", "14:00", "22:00", "09:00", "18:00"][i]!));
  const weekly = [-1, -8, -15].map((d) => taken("Hierro", addDays(TODAY, d), "21:00"));
  const nudges = scheduleNudges([med("Vitamina D"), med("Ibuprofeno"), med("Hierro")], [...daily, ...scattered, ...weekly], TODAY);
  expect(nudges.map((x) => [x.name, x.cadence, x.schedule.times, x.schedule.days])).toEqual([
    ["Vitamina D", "daily", ["08:10"], []],
    ["Hierro", "weekly", ["21:00"], [3]],
  ]);
  expect(nudges[0]!.detail).toBe("Todos los días a las 08:10, como la vienes tomando");
});

test("only active as-needed meds are nudged", () => {
  const scheduled = med("Levotiroxina", { schedule: { asNeeded: false, times: ["07:30"], days: [], training: null, meals: [], bedtime: false, interval: null, monthDay: null, windows: [], anyTime: false, reminder: null } });
  expect(scheduleNudges([scheduled, med("Ozempic", { active: false })], [], TODAY)).toEqual([]);
});
