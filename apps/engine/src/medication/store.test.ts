import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { localNow } from "./schedule";
import {
  addMedication,
  adherence,
  deleteMedication,
  dosesBetween,
  getMedication,
  listMedications,
  logDose,
  medicationDay,
  MedicationError,
  undoDose,
  updateMedication,
} from "./store";
import { medicationTools } from "./tools";

beforeEach(() => {
  db().exec("DELETE FROM medication_doses; DELETE FROM medications;");
});

const metformina = () =>
  addMedication({
    name: "Metformina",
    dose: 500,
    unit: "mg",
    form: "comprimido",
    instructions: "con comida",
    schedule: { asNeeded: false, times: ["20:00", "08:00"], days: [] },
    startDate: "2026-09-01",
    stock: 3,
    lowStockThreshold: 1,
  });

test("add normalizes and defaults; update patches only given fields", () => {
  const med = metformina();
  expect(med.kind).toBe("medicamento");
  expect(med.schedule).toEqual({ asNeeded: false, times: ["08:00", "20:00"], days: [], training: null, meals: [], bedtime: false, interval: null, monthDay: null, windows: [], anyTime: false, reminder: null });
  expect(med.active).toBe(true);
  expect(med.lowStock).toBe(false);

  const prn = addMedication({ name: "Ibuprofeno", dose: 400, unit: "mg" }, "2026-10-01");
  expect(prn.schedule.asNeeded).toBe(true);
  expect(prn.startDate).toBe("2026-10-01");

  const updated = updateMedication(med.id, { stock: 1, notes: "receta hasta diciembre" });
  expect(updated.lowStock).toBe(true);
  expect(updated.instructions).toBe("con comida");
  expect(updated.form).toBe("comprimido");

  updateMedication(prn.id, { active: false });
  expect(listMedications().map((m) => m.name)).toEqual(["Metformina"]);
  expect(listMedications({ includeInactive: true })).toHaveLength(2);
});

test("validation rejects bad input", () => {
  expect(() => addMedication({ name: "", dose: 1, unit: "mg" })).toThrow();
  expect(() => addMedication({ name: "X", dose: 1, unit: "mg", schedule: { asNeeded: false, times: ["8am"], days: [] } })).toThrow();
  expect(() => addMedication({ name: "X", dose: 1, unit: "mg", schedule: { asNeeded: false, times: [], days: [] } })).toThrow(MedicationError);
  expect(() => addMedication({ name: "X", dose: 1, unit: "mg", startDate: "2026-10-02", endDate: "2026-10-01" })).toThrow(MedicationError);
  expect(() => updateMedication("nope", { dose: 2 })).toThrow(MedicationError);
});

test("logging a slot overwrites it and stock follows 'tomada'", () => {
  const med = metformina();
  const slot = { medicationId: med.id, date: "2026-10-01", scheduledTime: "08:00" } as const;

  const first = logDose({ ...slot, status: "tomada" });
  expect(getMedication(med.id).stock).toBe(2);
  // Re-tapping "tomada" doesn't double-count
  logDose({ ...slot, status: "tomada" });
  expect(getMedication(med.id).stock).toBe(2);
  // Changing to omitida returns it
  const changed = logDose({ ...slot, status: "omitida" });
  expect(changed.id).toBe(first.id);
  expect(changed.takenAt).toBeNull();
  expect(getMedication(med.id).stock).toBe(3);

  logDose({ ...slot, status: "tomada" });
  logDose({ ...slot, scheduledTime: "20:00", status: "tomada" });
  logDose({ ...slot, date: "2026-10-02", status: "tomada" });
  expect(getMedication(med.id).stock).toBe(0);
  expect(getMedication(med.id).lowStock).toBe(true);
  // Never below zero
  logDose({ ...slot, date: "2026-10-02", scheduledTime: "20:00", status: "tomada" });
  expect(getMedication(med.id).stock).toBe(0);

  const event = dosesBetween("2026-10-02", "2026-10-02")[0]!;
  undoDose(event.id);
  expect(getMedication(med.id).stock).toBe(1);
  expect(() => undoDose(event.id)).toThrow(MedicationError);
});

test("as-needed intakes add events each time; scheduled meds need a time unless taken extra", () => {
  const prn = addMedication({ name: "Ibuprofeno", dose: 400, unit: "mg", stock: 10 });
  logDose({ medicationId: prn.id, date: "2026-10-01", status: "tomada" });
  logDose({ medicationId: prn.id, date: "2026-10-01", status: "tomada" });
  expect(dosesBetween("2026-10-01", "2026-10-01")).toHaveLength(2);
  expect(getMedication(prn.id).stock).toBe(8);

  const med = metformina();
  expect(() => logDose({ medicationId: med.id, date: "2026-10-01", status: "omitida" })).toThrow(MedicationError);
  expect(() => logDose({ medicationId: "nope", date: "2026-10-01", status: "tomada" })).toThrow(MedicationError);
});

test("medicationDay lists slots with status and the next pending one", () => {
  const med = metformina();
  addMedication({ name: "Ibuprofeno", dose: 400, unit: "mg" });
  logDose({ medicationId: med.id, date: "2026-10-01", scheduledTime: "08:00", status: "tomada" });
  const day = medicationDay("2026-10-01", "12:00");
  expect(day.slots.map((s) => [s.slot, s.status])).toEqual([
    ["08:00", "tomada"],
    ["20:00", "pendiente"],
  ]);
  expect(day.slots[0]?.eventId).toBeString();
  expect(day.next?.time).toBe("20:00");
  expect(medicationDay("2026-10-01", "21:00").next).toBeNull();
});

test("adherence from the store and cascade delete", () => {
  const med = metformina();
  logDose({ medicationId: med.id, date: "2026-09-30", scheduledTime: "08:00", status: "tomada" });
  logDose({ medicationId: med.id, date: "2026-09-30", scheduledTime: "20:00", status: "tomada" });
  logDose({ medicationId: med.id, date: "2026-10-01", scheduledTime: "08:00", status: "tomada" });
  const report = adherence("2026-10-01", "09:00");
  // 7 days incl. today: 6 full days × 2 slots + today's 08:00
  expect(report.overall.last7).toEqual({ due: 13, taken: 3, rate: 3 / 13 });
  // 09-30 complete; today's 20:00 still pending, so today doesn't count yet
  expect(report.medications[0]?.currentStreak).toBe(1);
  deleteMedication(med.id);
  expect(dosesBetween("2026-09-01", "2026-10-31")).toHaveLength(0);
});

const handler = (name: string) => medicationTools.find((t) => t.name === name)!.handler as (args: any, extra: unknown) => Promise<any>;
const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

test("tool handlers add, log, list and report; errors come back as tool errors", async () => {
  const added = parse(await handler("add_medication")({ name: "Magnesio", kind: "suplemento", dose: 300, unit: "mg", schedule: { asNeeded: false, times: ["22:00"], days: [] }, stock: 30 }, {}));
  expect(added.kind).toBe("suplemento");

  const today = localNow().date;
  const logged = parse(await handler("log_dose")({ medicationId: added.id, scheduledTime: "22:00", status: "tomada" }, {}));
  expect(logged.date).toBe(today);

  const listed = parse(await handler("list_medications")({ includeInactive: false, includeToday: true }, {}));
  expect(listed.medications[0].stock).toBe(29);
  expect(listed.today.slots[0].status).toBe("tomada");

  const updated = parse(await handler("update_medication")({ id: added.id, lowStockThreshold: 30 }, {}));
  expect(updated.lowStock).toBe(true);

  const report = parse(await handler("get_adherence")({ includeLog: true }, {}));
  expect(report.medications[0].currentStreak).toBe(1);
  expect(report.log).toHaveLength(1);

  const failed = await handler("update_medication")({ id: "nope", dose: 1 }, {});
  expect(failed.isError).toBe(true);
  expect(failed.content[0].text).toContain("no medication");
});

test("every tool states the medical-advice boundary", () => {
  expect(medicationTools.map((t) => t.name).sort()).toEqual(["add_medication", "get_adherence", "list_medications", "log_dose", "update_medication"]);
  for (const t of medicationTools) expect(t.description).toContain("doctor or pharmacist");
});

test("giving an as-needed med a schedule moves today's intakes onto today's open slots", () => {
  const { date: today } = localNow();
  const levo = addMedication({ name: "Levotiroxina", dose: 1, unit: "comprimido" }, today);
  logDose({ medicationId: levo.id, date: today, status: "tomada", takenAt: Date.now() });
  logDose({ medicationId: levo.id, date: "2026-01-01", status: "tomada", takenAt: Date.now() });
  updateMedication(levo.id, { schedule: { asNeeded: false, times: ["07:30"], days: [], training: null, meals: [], bedtime: false }, startDate: today }, today);
  expect(medicationDay(today, "23:59").slots.map((s) => [s.slot, s.status])).toEqual([["07:30", "tomada"]]);
  expect(medicationDay(today, "23:59").asNeeded).toEqual([]);
  // Other days keep their intakes as they were.
  expect(dosesBetween("2026-01-01", "2026-01-01")[0]!.scheduledTime).toBeNull();
});
