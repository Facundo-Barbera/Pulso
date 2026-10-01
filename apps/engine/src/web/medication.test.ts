import { expect, test } from "bun:test";
import type { DoseSlot } from "@pulso/contract";
import { addDays, localNow } from "../medication/schedule";
import { addMedication, listMedications, logDose, updateMedication } from "../medication/store";
import { groupSlots, HISTORY_DAYS, medicationPage, scheduleLine, slotLabel, trainingLine, unitFor } from "./medication";
import { ownDatabase } from "./test-db";

ownDatabase("web-medication");

const NOW = new Date(2033, 6, 14, 12, 0); // 12:00 local
const { date: today } = localNow(NOW);

test("an empty page has no slots, meds or history", () => {
  const page = medicationPage(NOW);
  expect(page.date).toBe(today);
  expect(page.time).toBe("12:00");
  expect(page.day.slots).toEqual([]);
  expect(page.medications).toEqual([]);
  expect(page.history).toEqual([]);
});

test("today's slots, as-needed counts, paused meds and the history grouped by day, newest first", () => {
  const vitamin = addMedication({ name: "Vitamina D", dose: 1000, unit: "UI", schedule: { asNeeded: false, times: ["09:00", "21:00"], days: [] }, startDate: addDays(today, -10) }, today);
  const ibuprofen = addMedication({ name: "Ibuprofeno", dose: 400, unit: "mg" }, today);
  const paused = addMedication({ name: "Magnesio", dose: 300, unit: "mg", schedule: { asNeeded: false, times: ["22:00"], days: [] } }, today);
  updateMedication(paused.id, { active: false });

  logDose({ medicationId: vitamin.id, date: today, scheduledTime: "09:00", status: "tomada", takenAt: NOW.getTime() - 3 * 3_600_000 });
  logDose({ medicationId: vitamin.id, date: addDays(today, -1), scheduledTime: "09:00", status: "omitida" });
  logDose({ medicationId: ibuprofen.id, date: today, status: "tomada", takenAt: NOW.getTime() - 3_600_000 });
  // Older than the history window: left out.
  logDose({ medicationId: vitamin.id, date: addDays(today, -HISTORY_DAYS), scheduledTime: "09:00", status: "tomada" });

  const page = medicationPage(NOW);
  expect(page.day.slots.map((s) => [s.time, s.status])).toEqual([["09:00", "tomada"], ["21:00", "pendiente"]]);
  expect(page.day.next?.time).toBe("21:00");
  expect(page.asNeeded).toEqual([{ medication: expect.objectContaining({ id: ibuprofen.id }), today: 1 }]);
  expect(page.medications.map((m) => m.name)).toEqual(["Ibuprofeno", "Vitamina D", "Magnesio"]);

  expect(page.history.map((d) => d.date)).toEqual([today, addDays(today, -1)]);
  expect(page.history[0]!.entries.map((e) => e.name)).toEqual(["Ibuprofeno", "Vitamina D"]);
  expect(page.history[1]!.entries[0]).toMatchObject({ name: "Vitamina D", status: "omitida", dose: 1000, unit: "UI" });
  expect(page.adherence.overall.last7.taken).toBe(1);
});

test("today's slots grouped by moment, training ones under «Después de entrenar» with their status", () => {
  for (const m of listMedications()) updateMedication(m.id, { active: false });
  const creatine = addMedication({ name: "Creatina", kind: "suplemento", dose: 5, unit: "g", schedule: { asNeeded: false, times: [], days: [], training: { withinMinutes: 60, restDayTime: "09:00" } } }, today);
  addMedication({ name: "Whey", kind: "suplemento", dose: 1, unit: "scoop", schedule: { asNeeded: false, times: [], days: [], training: { withinMinutes: 60, restDayTime: null } } }, today);
  addMedication({ name: "Omega 3", kind: "suplemento", dose: 1, unit: "cápsula", schedule: { asNeeded: false, times: [], days: [], meals: ["desayuno"] } }, today);

  // No workout and none planned: a rest day, so creatine falls to 09:00 and whey ("No tomar") has no slot.
  let page = medicationPage(NOW);
  expect(page.groups.map((g) => [g.title, g.slots.map((s) => [s.name, s.line])])).toEqual([
    ["Con el desayuno", [["Omega 3", null]]],
    ["Después de entrenar", [["Creatina", "Hoy descansas · 09:00"]]],
  ]);

  logDose({ medicationId: creatine.id, date: today, scheduledTime: "entreno", status: "tomada", takenAt: NOW.getTime() });
  page = medicationPage(NOW);
  expect(page.groups[1]!.slots[0]).toMatchObject({ status: "tomada", line: null });
  expect(page.history[0]!.entries[0]).toMatchObject({ name: "Creatina", scheduledTime: "entreno" });
});

const slot = (over: Partial<DoseSlot>): DoseSlot => ({
  medicationId: "m",
  name: "X",
  kind: "suplemento",
  dose: 1,
  unit: "g",
  instructions: null,
  date: today,
  slot: "09:00",
  moment: "hora",
  time: "09:00",
  training: null,
  status: "pendiente",
  eventId: null,
  takenAt: null,
  ...over,
});
const waiting = { workoutEnd: null, until: null, plannedAt: null, fallback: null };

test("groupSlots: fixed times by the clock, meals and bedtime by moment, every training state in Spanish", () => {
  const groups = groupSlots(
    [
      slot({ name: "A", slot: "08:00", time: "08:00" }),
      slot({ name: "B", slot: "08:00", time: "08:00" }),
      slot({ name: "C", slot: "comida", moment: "comida", time: "14:00" }),
      slot({ name: "D", slot: "entreno", moment: "entreno", time: "19:05", training: { ...waiting, state: "trained", workoutEnd: "19:05", until: "19:50" } }),
      slot({ name: "E", slot: "dormir", moment: "dormir", time: "22:30" }),
      slot({ name: "F", slot: "entreno", moment: "entreno", time: null, training: { ...waiting, state: "planned", plannedAt: "18:00", fallback: "21:00" } }),
    ],
    "19:10",
  );
  expect(groups.map((g) => [g.title, g.time, g.slots.map((s) => s.name)])).toEqual([
    ["08:00", null, ["A", "B"]],
    ["Con la comida", "14:00", ["C"]],
    ["Después de entrenar", null, ["D", "F"]],
    ["Antes de dormir", "22:30", ["E"]],
  ]);
  expect(groups[2]!.slots.map((s) => s.line)).toEqual(["Terminaste a las 19:05 · tómala antes de las 19:50", "Al terminar tu sesión de las 18:00"]);
  expect(trainingLine({ ...waiting, state: "training", fallback: "09:00" }, "10:00")).toBe("Entrenando…");
  expect(trainingLine({ ...waiting, state: "trained", workoutEnd: "19:05", until: "19:50" }, "20:30")).toBe("Terminaste a las 19:05 · era antes de las 19:50");
});

test("schedules, slot keys and units read in Spanish", () => {
  const base = { asNeeded: false, times: [], days: [], training: null, meals: [], bedtime: false };
  expect(scheduleLine({ ...base, training: { withinMinutes: 60, restDayTime: "09:00" } })).toBe("Después de entrenar · días sin entreno 09:00");
  expect(scheduleLine({ ...base, training: { withinMinutes: 60, restDayTime: null } })).toBe("Después de entrenar · solo días de entreno");
  expect(scheduleLine({ ...base, meals: ["comida"] })).toBe("Con la comida");
  expect(scheduleLine({ ...base, meals: ["desayuno", "cena"] })).toBe("Con el desayuno y la cena");
  expect(scheduleLine({ ...base, times: ["08:00", "20:00"] })).toBe("08:00 y 20:00");
  expect(scheduleLine({ ...base, times: ["08:00"], bedtime: true, days: [1, 3, 5] })).toBe("L X V · 08:00 · antes de dormir");
  expect(scheduleLine({ ...base, asNeeded: true })).toBe("Cuando haga falta");

  expect(["09:00", "entreno", "desayuno", "dormir"].map(slotLabel)).toEqual(["las 09:00", "después de entrenar", "con el desayuno", "antes de dormir"]);
  expect([unitFor(1, "cápsulas"), unitFor(2, "cápsula"), unitFor(1, "scoop"), unitFor(5, "g")]).toEqual(["cápsula", "cápsulas", "scoop", "g"]);
});
