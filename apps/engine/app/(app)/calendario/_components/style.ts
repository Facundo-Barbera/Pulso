import type { CalendarItem } from "@pulso/contract";
import { Activity, Bed, Briefcase, Dumbbell, HeartPulse, PersonStanding, Pill, Utensils, type LucideIcon } from "lucide-react";

/** The timeline's colour keys as Pulso's domain colours. Busy time stays neutral. */
export const COLOR: Record<CalendarItem["color"], string> = {
  training: "var(--domain-training)",
  workout: "var(--domain-energy)",
  nutrition: "var(--domain-protein)",
  medication: "var(--domain-medication)",
  sleep: "var(--domain-sleep)",
  busy: "var(--muted-foreground)",
  health: "var(--domain-heart)",
  body: "var(--domain-body)",
};

export const ICON: Record<CalendarItem["kind"], LucideIcon> = {
  training: Dumbbell,
  workout: Activity,
  meal: Utensils,
  meal_time: Utensils,
  dose: Pill,
  sleep: Bed,
  busy: Briefcase,
  health: HeartPulse,
  body_scan: PersonStanding,
};

export const LEGEND: { color: CalendarItem["color"]; label: string }[] = [
  { color: "training", label: "Entreno" },
  { color: "workout", label: "Actividad" },
  { color: "nutrition", label: "Comidas" },
  { color: "medication", label: "Medicación" },
  { color: "sleep", label: "Sueño" },
  { color: "busy", label: "Ocupado" },
  { color: "health", label: "Salud" },
  { color: "body", label: "Cuerpo" },
];

export const PLAN_STATUS: Record<string, string> = { planned: "Planificada", moved: "Movida", done: "Hecha", skipped: "Saltada", missed: "No hecha" };
export const HEALTH_STATUS: Record<string, string> = { activa: "Activa", recuperandose: "Recuperándose", resuelta: "Resuelta" };

/** Where an item opens on the web. Busy blocks and health events open their editor instead (null). */
export function hrefOf(item: CalendarItem): string | null {
  switch (item.kind) {
    case "busy":
    case "health":
      return null;
    case "training":
      return "/entreno";
    case "meal":
    case "meal_time":
      return "/dieta";
    case "dose":
      return "/medicacion";
    case "sleep":
      return `/sueno?noche=${item.date}`;
    case "body_scan":
      return "/cuerpo";
    default:
      return "/";
  }
}

export const timeOf = (datetime: string | null) => datetime?.slice(11, 16) ?? null;

export const hasConflict = (item: CalendarItem) => item.subtitle?.startsWith("Conflicto") === true;

/**
 * A day as the week grid shows it: the doses folded into one row and the
 * meals into another, so a column reads at a glance. The day list keeps all.
 */
export function condense(items: CalendarItem[]): CalendarItem[] {
  const doses = items.filter((i) => i.kind === "dose");
  const meals = items.filter((i) => i.kind === "meal");
  const mealTimes = items.filter((i) => i.kind === "meal_time");
  const out = items.filter((i) => i.kind !== "dose" && i.kind !== "meal" && i.kind !== "meal_time");
  const date = items[0]?.date ?? "";
  if (meals.length || mealTimes.length) {
    const kcal = meals.reduce((sum, m) => sum + Number(/(\d+) kcal/.exec(m.subtitle ?? "")?.[1] ?? 0), 0);
    out.push({
      ...(meals[0] ?? mealTimes[0])!,
      id: `meals:${date}`,
      kind: meals.length ? "meal" : "meal_time",
      title: meals.length ? `${meals.length} ${meals.length === 1 ? "comida" : "comidas"}` : "Comidas previstas",
      subtitle: meals.length ? `${kcal.toLocaleString("es")} kcal${mealTimes.length ? ` · ${mealTimes.length} por registrar` : ""}` : mealTimes.map((m) => timeOf(m.start)).join(" · "),
      start: (meals[0] ?? mealTimes[0])!.start,
    });
  }
  if (doses.length) {
    const taken = doses.filter((d) => d.status === "tomada").length;
    out.push({ ...doses[0]!, id: `doses:${date}`, title: "Medicación", subtitle: `${taken} ${taken === 1 ? "tomada" : "tomadas"}${doses.length > taken ? ` · ${doses.length - taken} sin tomar` : ""}`, allDay: false });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start ?? "").localeCompare(b.start ?? ""));
}

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** "lunes y jueves" from ISO weekdays. */
export function weekdayList(days: number[]): string {
  const names = days.map((d) => WEEKDAY_NAMES[d - 1]!);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}
