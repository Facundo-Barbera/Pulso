/**
 * Schedules in words, with no server imports so the client-side editor can read
 * its draft back as the person edits it.
 */
import type { MedicationSchedule } from "@pulso/contract";

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
const PART_PHRASE = { manana: "en la mañana", tarde: "en la tarde", noche: "en la noche" } as const;
const MEAL_PHRASE = { desayuno: "con el desayuno", comida: "con la comida", cena: "con la cena" } as const;

const list = (items: string[]) => new Intl.ListFormat("es", { type: "conjunction" }).format(items);

/** Which days, in words: "Semanal · jueves", "L X V", "Cada 3 días", "Cada 2 semanas · lunes", "Cada mes · día 5"; null for every day. */
export function frequencyLine(s: Pick<MedicationSchedule, "days" | "interval" | "monthDay">): string | null {
  const days = s.days.length === 1 ? WEEKDAY_NAMES[s.days[0]! - 1]! : s.days.map((d) => DAY_LETTERS[d - 1]).join(" ");
  if (s.monthDay) return `Cada mes · día ${s.monthDay}`;
  if (s.interval?.unit === "day") return `Cada ${s.interval.every} días`;
  if (s.interval) return `Cada ${s.interval.every} semanas · ${days}`;
  if (s.days.length === 1) return `Semanal · ${days}`;
  return s.days.length ? days : null;
}

/** The whole schedule in one line, for the editor: "Semanal · jueves · cuando quieras · aviso 19:00 si no la tomaste". */
export function readBack(s: MedicationSchedule): string {
  if (s.asNeeded) return "Cuando haga falta · sin horario ni avisos";
  const parts = [frequencyLine(s) ?? "Cada día"];
  if (s.times.length) parts.push(`a las ${list(s.times)}`);
  if (s.windows.length) parts.push(list(s.windows.map((w) => `${PART_PHRASE[w.part]}, ${w.start}–${w.end}`)));
  if (s.anyTime) {
    parts.push("cuando quieras");
    if (s.reminder) parts.push(`aviso ${s.reminder} si no la tomaste`);
  }
  if (s.training) {
    parts.push(`después de entrenar, dentro de ${s.training.withinMinutes} min`);
    parts.push(s.training.restDayTime ? `sin entreno, a las ${s.training.restDayTime}` : "sin entreno, no");
  }
  if (s.meals.length) parts.push(list(s.meals.map((m) => MEAL_PHRASE[m])));
  if (s.bedtime) parts.push("antes de dormir");
  return parts.join(" · ");
}
