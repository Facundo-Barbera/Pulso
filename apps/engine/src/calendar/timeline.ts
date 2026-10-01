/**
 * One timeline from every feature: planned and logged training, Health
 * workouts, meals and planned meal times, medication doses, sleep, busy
 * blocks, health events and body scans. Read-only over the other stores.
 */
import type { CalendarItem, CalendarRange, HealthEvent, MealSlot } from "@pulso/contract";
import { listMedications, dosesBetween } from "../medication/store";
import { listMeals } from "../nutrition/store";
import { listSleepNights } from "../sleep/store";
import { AREA_NAMES } from "./planner";
import { expand } from "./recurrence";
import { plannedView } from "./schedule";
import { healthWorkouts, loggedSessions, scansBetween } from "./sources";
import { CalendarError, listBusyBlocks, listHealthEvents, mealTimesBetween } from "./store";
import { addDays, DATE, daysBetween, local, localDateTime, TIME } from "./time";

/** The longest range one request may ask for. */
export const MAX_DAYS = 125;

export const SLOT_NAMES: Record<MealSlot, string> = {
  desayuno: "Desayuno", media_manana: "Media mañana", comida: "Comida", merienda: "Merienda", cena: "Cena", snack: "Snack",
};

const KIND_NAMES: Record<HealthEvent["kind"], string> = { lesion: "Lesión", enfermedad: "Enfermedad", sintoma: "Síntoma", cirugia: "Cirugía", otro: "Otro" };

const ACTIVITIES: Record<string, string> = {
  running: "Carrera", walking: "Caminata", hiking: "Senderismo", cycling: "Ciclismo", swimming: "Natación", strength: "Fuerza",
  functional_strength: "Fuerza", hiit: "HIIT", yoga: "Yoga", rowing: "Remo", elliptical: "Elíptica", core: "Core",
  flexibility: "Flexibilidad", cross_training: "Entrenamiento cruzado", soccer: "Fútbol",
};

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min` : `${Math.round(min)} min`);
const at = (date: string, time: string) => `${date}T${time}`;
const plusMinutes = (date: string, time: string, add: number) => {
  const [h, m] = time.split(":").map(Number);
  const total = h! * 60 + m! + add;
  return at(addDays(date, Math.floor(total / 1440)), `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
};

export function validRange(from: string | null, to: string | null): { from: string; to: string } {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new CalendarError("invalid_request", "expected from=YYYY-MM-DD&to=YYYY-MM-DD");
  if (to < from) throw new CalendarError("invalid_request", "to must be on or after from");
  if (daysBetween(from, to) >= MAX_DAYS) throw new CalendarError("invalid_request", `at most ${MAX_DAYS} days per request`);
  return { from, to };
}

export function timeline(from: string, to: string, now = new Date()): CalendarRange {
  const today = local(now).date;
  const items: CalendarItem[] = [];

  // Training: the plan (marked done when a session of that day was logged), then logged sessions nobody planned.
  const planned = plannedView(from, to, today);
  for (const p of planned) {
    const subtitle = p.conflict ? `Conflicto: ${p.conflict}` : p.movedFrom && p.status !== "done" ? `Movida desde el ${p.movedFrom.slice(8)}/${p.movedFrom.slice(5, 7)}` : `${p.durationMin} min`;
    items.push({
      id: `plan:${p.id}`, kind: "training", title: p.name, subtitle, date: p.date, start: at(p.date, p.time), end: plusMinutes(p.date, p.time, p.durationMin),
      allDay: false, color: "training", status: p.status, link: { tab: "entreno", id: p.sessionId ?? p.dayId },
    });
  }
  const fulfilled = new Set(planned.map((p) => p.sessionId));
  const sessions = loggedSessions(from, to);
  for (const s of sessions.filter((s) => !fulfilled.has(s.id))) {
    items.push({
      id: `session:${s.id}`, kind: "training", title: s.name, subtitle: hm((s.endedAt - s.startedAt) / 60_000), date: s.date,
      start: localDateTime(s.startedAt), end: localDateTime(s.endedAt), allDay: false, color: "training", status: "done", link: { tab: "entreno", id: s.id },
    });
  }

  // Health workouts, minus the ones that are a Pulso session written back to Health.
  for (const w of healthWorkouts(from, to)) {
    if (sessions.some((s) => w.startedAt < s.endedAt && s.startedAt < w.endedAt)) continue;
    const parts = [hm((w.endedAt - w.startedAt) / 60_000)];
    if (w.energy) parts.push(`${Math.round(w.energy)} kcal`);
    if (w.distance) parts.push(`${(w.distance / 1000).toFixed(1)} km`);
    items.push({
      id: `workout:${w.id}`, kind: "workout", title: ACTIVITIES[w.activity] ?? "Entrenamiento", subtitle: parts.join(" · "), date: local(w.startedAt).date,
      start: localDateTime(w.startedAt), end: localDateTime(w.endedAt), allDay: false, color: "workout", status: w.activity, link: { tab: "hoy", id: w.id },
    });
  }

  // Meals: one marker per logged slot; planned meal times only from today on, and only where nothing is logged yet.
  const logged = new Set<string>();
  const bySlot = new Map<string, ReturnType<typeof listMeals>>();
  for (const m of listMeals(from, to)) bySlot.set(`${m.date}|${m.slot}`, [...(bySlot.get(`${m.date}|${m.slot}`) ?? []), m]);
  for (const [key, entries] of bySlot) {
    const [date, slot] = key.split("|") as [string, MealSlot];
    logged.add(key);
    const kcal = Math.round(entries.reduce((sum, e) => sum + e.kcal, 0));
    items.push({
      id: `meal:${key}`, kind: "meal", title: SLOT_NAMES[slot], subtitle: `${entries.length === 1 ? entries[0]!.name : `${entries.length} alimentos`} · ${kcal} kcal`,
      date, start: localDateTime(Math.min(...entries.map((e) => e.eatenAt))), end: null, allDay: false, color: "nutrition", status: null, link: { tab: "dieta", id: null },
    });
  }
  if (to >= today) {
    for (const [date, meals] of Object.entries(mealTimesBetween(from < today ? today : from, to))) {
      for (const m of meals.filter((m) => !logged.has(`${date}|${m.slot}`))) {
        items.push({
          id: `mealtime:${date}|${m.slot}`, kind: "meal_time", title: SLOT_NAMES[m.slot], subtitle: "Hora prevista", date, start: at(date, m.time), end: null,
          allDay: false, color: "nutrition", status: null, link: { tab: "dieta", id: null },
        });
      }
    }
  }

  // Medication: what was logged, taken at its real time, skipped at its slot.
  const meds = new Map(listMedications({ includeInactive: true }).map((m) => [m.id, m]));
  for (const d of dosesBetween(from, to)) {
    const med = meds.get(d.medicationId);
    const start = d.status === "tomada" && d.takenAt ? localDateTime(d.takenAt) : d.scheduledTime && TIME.test(d.scheduledTime) ? at(d.date, d.scheduledTime) : null;
    const label = d.status === "tomada" ? "Tomada" : d.status === "omitida" ? "Omitida" : "Pospuesta";
    items.push({
      id: `dose:${d.id}`, kind: "dose", title: med?.name ?? "Medicamento", subtitle: med ? `${label} · ${med.dose} ${med.unit}` : label, date: d.date, start, end: null,
      allDay: start === null, color: "medication", status: d.status, link: { tab: "hoy", id: d.medicationId },
    });
  }

  for (const n of listSleepNights(from, to)) {
    items.push({
      id: `sleep:${n.night}`, kind: "sleep", title: "Sueño", subtitle: hm(n.minutes.asleep), date: n.night, start: localDateTime(n.asleepStart), end: localDateTime(n.asleepEnd),
      allDay: false, color: "sleep", status: null, link: { tab: "hoy", id: n.night },
    });
  }

  for (const o of expand(listBusyBlocks({ from, to }), from, to)) {
    items.push({
      id: `busy:${o.blockId}:${o.date}`, kind: "busy", title: o.title, subtitle: o.source === "apple_calendar" ? "Calendario" : null, date: o.date,
      start: o.allDay ? null : at(o.date, o.start!), end: o.allDay ? null : at(o.date, o.end!), allDay: o.allDay, color: "busy", status: o.source,
      link: { tab: "calendario", id: o.blockId },
    });
  }

  // Health events, one all-day item per day; an ongoing one runs through today, not into the future.
  for (const e of listHealthEvents({ from, to })) {
    const last = [e.endDate ?? (today > e.startDate ? today : e.startDate), to].sort()[0]!;
    const subtitle = [KIND_NAMES[e.kind], e.bodyArea && AREA_NAMES[e.bodyArea], `${e.severity}/5`].filter(Boolean).join(" · ");
    for (let date = e.startDate > from ? e.startDate : from; date <= last; date = addDays(date, 1)) {
      items.push({
        id: `health:${e.id}:${date}`, kind: "health", title: e.title, subtitle, date, start: null, end: null, allDay: true, color: "health", status: e.status,
        link: { tab: "calendario", id: e.id },
      });
    }
  }

  for (const s of scansBetween(from, to)) {
    const parts = [s.weight != null && `${s.weight} kg`, s.percentBodyFat != null && `${s.percentBodyFat} % grasa`].filter(Boolean);
    items.push({
      id: `scan:${s.id}`, kind: "body_scan", title: s.source === "inbody" ? "InBody" : "Medición corporal", subtitle: parts.join(" · ") || null,
      date: local(s.measuredAt).date, start: localDateTime(s.measuredAt), end: null, allDay: false, color: "body", status: null, link: { tab: "cuerpo", id: s.id },
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.start ?? "").localeCompare(b.start ?? ""));
  return { from, to, items };
}
