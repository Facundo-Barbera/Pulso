import { expect, test } from "bun:test";
import type { MedicationSchedule } from "@pulso/contract";
import { readBack } from "./read-back";

const base: MedicationSchedule = { asNeeded: false, times: [], days: [], interval: null, monthDay: null, training: null, meals: [], bedtime: false, windows: [], anyTime: false, reminder: null };

test("the editor reads a schedule back in one line", () => {
  expect(readBack({ ...base, days: [4], anyTime: true, reminder: "19:00" })).toBe("Semanal · jueves · cuando quieras · aviso 19:00 si no la tomaste");
  expect(readBack({ ...base, days: [4], anyTime: true })).toBe("Semanal · jueves · cuando quieras");
  expect(readBack({ ...base, times: ["08:00", "20:00"] })).toBe("Cada día · a las 08:00 y 20:00");
  expect(readBack({ ...base, training: { withinMinutes: 60, restDayTime: null } })).toBe("Cada día · después de entrenar, dentro de 60 min · sin entreno, no");
  expect(readBack({ ...base, windows: [{ part: "manana", start: "07:00", end: "12:00" }] })).toBe("Cada día · en la mañana, 07:00–12:00");
  expect(readBack({ ...base, monthDay: 5, meals: ["desayuno"] })).toBe("Cada mes · día 5 · con el desayuno");
  expect(readBack({ ...base, asNeeded: true })).toBe("Cuando haga falta · sin horario ni avisos");
});
