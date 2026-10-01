import { expect, test } from "bun:test";
import { addDays, localNow } from "../medication/schedule";
import { addMedication, logDose, updateMedication } from "../medication/store";
import { HISTORY_DAYS, medicationPage } from "./medication";
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
