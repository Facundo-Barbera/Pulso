/**
 * Action cards: what a Coach tool changed, said for the person — a title, a few
 * lines with before → after, where it lives and how to undo it. Each write tool
 * can have a formatter here; any other write tool gets a plain fallback card.
 * Reads get no card. Never throws: an unexpected shape just means a plainer card.
 */
import type {
  ActiveProgramResponse,
  AgentActionLine,
  AgentResultPlace,
  AgentResultTab,
  AgentToolResult,
  BodyGoal,
  DayAdjustment,
  DietPlan,
  DoseEvent,
  MealEntry,
  ManualSleepNight,
  Medication,
  MedicationSchedule,
  NutritionTargets,
  PlanChange,
  Profile,
  Program,
  SavedDish,
  SessionSaved,
  WaterEntry,
} from "@pulso/contract";
import { localNow } from "../medication/schedule";
import { dosesBetween, getMedication } from "../medication/store";
import { getManualNight, manualNightOn } from "../sleep/manual";
import { formatDuration } from "../sleep/metrics";
import { accessOf, classified } from "../mcp/access";
import { getTargets } from "../nutrition/store";
import { snapshotProgramDays, type ProgramDaysSnapshot } from "../training/store";
import { getProfile } from "./profile";

/** How Deshacer puts a change back. Engine-only: stored with the tool, never sent to clients. */
export type Revert =
  | { kind: "profile"; patch: Record<string, unknown> }
  | { kind: "meals"; ids: string[] }
  | { kind: "plan"; revisionId: string }
  | { kind: "dose"; id: string }
  | { kind: "water"; id: string }
  | { kind: "medication_added"; id: string }
  | { kind: "medication"; id: string; patch: Record<string, unknown> }
  | { kind: "sleep_added"; id: string }
  | { kind: "sleep"; id: string; patch: { start: number; end: number; tzOffsetMin: number; note: string | null } }
  | { kind: "sleep_deleted"; night: ManualSleepNight }
  | { kind: "program"; before: ProgramDaysSnapshot; after: string | null };

export type Action = { card: AgentToolResult; revert?: Revert };

type Line = AgentActionLine | string | null | undefined | false;
/** `group`: the change it is part of (see AgentToolResult.group); consecutive cards with the same one show as one. */
type Card = { title: string; tab: AgentResultTab; place?: AgentResultPlace; lines?: Line[]; revert?: Revert; group?: string };
type Formatter = (result: any, input: any, before: any) => Card | null;
type Entry = { format: Formatter; /** Reads what the tool is about to change, before it runs. */ before?: (input: any) => unknown };

const MAX_LINES = 5;
const MAX_VALUE = 90;

const n = (value: number) => Math.round(value).toLocaleString("es-ES");
const days = (count: number) => (count === 1 ? "1 día" : `${count} días`);
const cut = (text: string) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1).trimEnd()}…` : text);
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es-ES") + text.slice(1);
const time = (ms: number) => new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const change = (label: string | null, before: string | null | undefined, value: string): AgentActionLine => ({
  label,
  before: before == null || before === value ? null : cut(before),
  value: cut(value),
});

const METRICS: Record<string, [string, string]> = {
  weight: ["Peso", "kg"],
  bodyFatMass: ["Grasa", "kg"],
  skeletalMuscleMass: ["Músculo", "kg"],
  percentBodyFat: ["Grasa", "%"],
};

const SLOTS: Record<string, string> = {
  desayuno: "Desayuno",
  media_manana: "Media mañana",
  comida: "Comida",
  merienda: "Merienda",
  cena: "Cena",
  snack: "Snack",
};

/** "Noche del 3 oct · 23:30 → 07:10 · 7 h 40 min". */
const sleepSpan = (n: ManualSleepNight) => {
  const day = new Date(`${n.night}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Noche del ${day} · ${time(n.start)} → ${time(n.end)} · ${formatDuration((n.end - n.start) / 60_000)}`;
};

// --- Profile ---

const PROFILE_LABELS: Record<keyof Profile, string> = {
  age: "Edad",
  sex: "Sexo",
  heightCm: "Altura",
  goals: "Objetivo",
  experience: "Experiencia",
  equipment: "Equipo",
  schedule: "Disponibilidad",
  injuries: "Lesiones",
  allergies: "Alergias",
  foodPreferences: "Comida",
  notes: "Notas",
};
const SEXES: Record<string, string> = { male: "Hombre", female: "Mujer", other: "Otro" };

function profileValue(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (key === "age") return `${value} años`;
  if (key === "heightCm") return `${value} cm`;
  if (key === "sex") return SEXES[String(value)] ?? String(value);
  return String(value).replace(/\s+/g, " ").trim();
}

function updateProfileCard(saved: Profile, patch: Record<string, unknown>, before: Profile | undefined): Card {
  const keys = Object.keys(patch).filter((k): k is keyof Profile => k in PROFILE_LABELS && patch[k] !== undefined);
  const changed = before ? keys.filter((k) => profileValue(k, before[k]) !== profileValue(k, saved[k])) : keys;
  const lines = changed.map((k) => change(PROFILE_LABELS[k], before && profileValue(k, before[k]), profileValue(k, saved[k]) ?? "Borrado"));
  return {
    title: "Perfil actualizado",
    tab: "cuerpo",
    place: "perfil",
    group: "profile",
    lines: lines.length ? lines : ["Sin cambios"],
    revert: before && changed.length ? { kind: "profile", patch: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])) } : undefined,
  };
}

// --- Meals ---

function mealCard(entries: MealEntry[], input: { addToDish?: string } | undefined): Card | null {
  if (!Array.isArray(entries) || !entries.length) return null;
  const first = entries[0]!;
  const kcal = entries.reduce((sum, e) => sum + (e.kcal ?? 0), 0);
  const protein = entries.reduce((sum, e) => sum + (e.protein ?? 0), 0);
  const names = entries.map((e) => e.name).filter(Boolean);
  const what = first.dish?.name ?? first.note ?? (names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`);
  const when = [SLOTS[first.slot], typeof first.eatenAt === "number" ? time(first.eatenAt) : null].filter(Boolean).join(" · ");
  return {
    title: input?.addToDish ? "Añadido al platillo" : "Comida registrada",
    tab: "dieta",
    lines: [what, `${n(kcal)} kcal${protein ? ` · ${n(protein)} g proteína` : ""}`, when],
    // Adding to a logged dish returns the whole dish: undo would take the earlier foods too.
    revert: input?.addToDish ? undefined : { kind: "meals", ids: entries.map((e) => e.id).filter(Boolean) },
  };
}

// --- Diet plan ---

/** "Cena del martes: tortitas en vez de quesadillas (−120 kcal)." → Cena del martes: Quesadillas → Tortitas (−120 kcal). */
function planLine(text: string): Line {
  const sentence = capitalize(text);
  const swap = /^(.+?): (.+?) en vez de (.+?)(?: (\([^)]*\)))?\.?$/.exec(sentence);
  if (swap) return change(swap[1]!, capitalize(swap[3]!), capitalize(swap[2]!) + (swap[4] ? ` ${swap[4]}` : ""));
  return sentence.replace(/\.$/, "");
}

const PLAN_TITLES: Record<string, string> = {
  skip_slot: "Comida saltada",
  ate_out: "Comida fuera registrada",
  schedule_prep: "Preparación programada",
  mark_prep_cooked: "Preparación cocinada",
  use_leftover: "Sobras aprovechadas",
  undo_plan_change: "Cambio del plan deshecho",
};

const planCard =
  (name: string): Formatter =>
  (c: PlanChange & { preview?: boolean }) => {
    if (c.preview || typeof c.summary !== "string") return null;
    const sentences = c.summary.replace(/^Deshecho: /, "").split(/(?<=\.)\s+/).filter(Boolean);
    return {
      title: PLAN_TITLES[name] ?? "Plan ajustado",
      tab: "dieta",
      group: c.revision?.planId ? `plan:${c.revision.planId}` : undefined,
      lines: sentences.map(planLine),
      revert: name !== "undo_plan_change" && c.revision?.id ? { kind: "plan", revisionId: c.revision.id } : undefined,
    };
  };

const PLAN_TOOLS = [
  "skip_slot",
  "replace_slot",
  "ate_out",
  "place_meal",
  "rebalance_day",
  "spread_deviation",
  "ingredient_unavailable",
  "no_time_to_cook",
  "move_slot",
  "swap_days",
  "fill_slot",
  "schedule_prep",
  "mark_prep_cooked",
  "use_leftover",
  "undo_plan_change",
];

const MACRO_LINES: [keyof NutritionTargets, string, string][] = [
  ["kcal", "Calorías", "kcal"],
  ["protein", "Proteína", "g"],
  ["carbs", "Carbohidratos", "g"],
  ["fat", "Grasa", "g"],
];

// --- Program ---

/** What the training tools hand a program change's card (training/tools.ts programCard). */
type ProgramChange = { programId?: string; name?: string; scope: "today" | "always"; days?: { id: string; name: string; exercises: number }[]; after: string | null };

/** One line per day changed, "Torso A: 7 → 5 ejercicios"; Deshacer puts the days back as they were. */
function programChangeCard(title: string, c: ProgramChange, before: ProgramDaysSnapshot | undefined, extra: Line[] = []): Card {
  const was = new Map(before?.days.map((d) => [d.dayId, (c.scope === "today" ? (d.override ?? d.exercises) : d.exercises).length]));
  const count = (k: number | undefined) => (k === undefined ? null : k === 1 ? "1 ejercicio" : `${k} ejercicios`);
  return {
    title,
    tab: "entreno",
    lines: [...extra, ...(c.days ?? []).map((d) => change(d.name, count(was.get(d.id)), count(d.exercises)!))],
    group: c.programId ? `program:${c.programId}` : undefined,
    revert: before && c.programId === before.programId ? { kind: "program", before, after: c.after } : undefined,
  };
}

// --- Medication ---

const MOMENTS: Record<string, string> = {
  entreno: "Después de entrenar",
  desayuno: "Con el desayuno",
  comida: "Con la comida",
  cena: "Con la cena",
  dormir: "Antes de dormir",
};
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** "Después de entrenar · 08:00", "Cuando haga falta", "Con la cena · lun, mié, vie". */
export function describeSchedule(s: MedicationSchedule | undefined): string | null {
  if (!s) return null;
  if (s.asNeeded) return "Cuando haga falta";
  const when = [
    s.training ? MOMENTS.entreno : null,
    ...(s.meals ?? []).map((m) => MOMENTS[m]),
    s.bedtime ? MOMENTS.dormir : null,
    ...(s.times ?? []),
  ].filter(Boolean);
  const on = s.days?.length && s.days.length < 7 ? s.days.map((d) => WEEKDAYS[d - 1]).filter(Boolean).join(", ") : null;
  return [when.join(" · "), on].filter(Boolean).join(" · ") || null;
}

const doseOf = (m: Medication) => `${m.name} · ${m.dose} ${m.unit}`;

const MEDICATION_FIELDS: [keyof Medication, string, (m: Medication) => string | null][] = [
  ["name", "Nombre", (m) => m.name],
  ["dose", "Dosis", (m) => `${m.dose} ${m.unit}`],
  ["unit", "Dosis", (m) => `${m.dose} ${m.unit}`],
  ["schedule", "Cuándo", (m) => describeSchedule(m.schedule)],
  ["instructions", "Cómo", (m) => m.instructions],
  ["stock", "Quedan", (m) => (m.stock === null ? null : String(m.stock))],
  ["endDate", "Hasta", (m) => m.endDate],
  ["active", "Estado", (m) => (m.active ? "Activa" : "Pausada")],
  ["notes", "Notas", (m) => m.notes],
];
const PATCHABLE = new Set(["name", "kind", "dose", "unit", "form", "instructions", "schedule", "startDate", "endDate", "stock", "lowStockThreshold", "active", "notes"]);

function updateMedicationCard(m: Medication, input: Record<string, unknown>, before: Medication | undefined): Card {
  const lines: Line[] = [m.name];
  const seen = new Set<string>();
  for (const [key, label, show] of MEDICATION_FIELDS) {
    if (input[key] === undefined || seen.has(label)) continue;
    const now = show(m);
    const was = before ? show(before) : null;
    if (before && was === now) continue;
    seen.add(label);
    lines.push(change(label, was, now ?? "Sin definir"));
  }
  const keys = Object.keys(input).filter((k) => PATCHABLE.has(k));
  return {
    title: m.kind === "suplemento" ? "Suplemento actualizado" : "Medicamento actualizado",
    tab: "hoy",
    place: "medicacion",
    group: `medication:${m.id}`,
    lines,
    revert: before && keys.length ? { kind: "medication", id: m.id, patch: Object.fromEntries(keys.map((k) => [k, before[k as keyof Medication]])) } : undefined,
  };
}

const DOSE_TITLES: Record<string, string> = { tomada: "Toma registrada", omitida: "Dosis omitida", pospuesta: "Dosis pospuesta" };

function doseCard(d: DoseEvent, _input: unknown, existed: boolean | undefined): Card | null {
  if (!d?.medicationId) return null;
  let med: Medication | undefined;
  try {
    med = getMedication(d.medicationId);
  } catch {}
  const slot = d.scheduledTime === null ? "Toma extra" : (MOMENTS[d.scheduledTime] ?? d.scheduledTime);
  return {
    title: DOSE_TITLES[d.status] ?? "Dosis registrada",
    tab: "hoy",
    place: "medicacion",
    lines: [med ? doseOf(med) : null, [slot, d.takenAt ? `tomada a las ${time(d.takenAt)}` : null].filter(Boolean).join(" · ")],
    // Undo removes the event: only when it didn't overwrite an earlier one.
    revert: existed === false ? { kind: "dose", id: d.id } : undefined,
  };
}

// --- The registry ---

/** Write tools with a card of their own, keyed by tool name (no `mcp__pulso__` prefix). */
const ACTIONS: Record<string, Entry> = {
  update_profile: { before: () => getProfile(), format: updateProfileCard },
  log_meal: { format: mealCard },
  log_dish: { format: (entries: MealEntry[]) => mealCard(entries, undefined) },
  ...Object.fromEntries(PLAN_TOOLS.map((name) => [name, { format: planCard(name) }])),
  adjust_day_plan: {
    format: (a: DayAdjustment & { stored: boolean }) => ({ title: a.stored ? "Plan de hoy ajustado" : "Sin comidas por ajustar", tab: "dieta", lines: [a.summary] }),
  },
  create_diet_plan: { format: (p: DietPlan) => ({ title: "Plan de comidas creado", tab: "dieta", lines: [`${p.name} · ${days(p.days.length)}`] }) },
  set_targets: {
    before: () => getTargets(),
    format: (t: NutritionTargets, _input, before: NutritionTargets | null | undefined) => {
      const lines = MACRO_LINES.filter(([k]) => typeof t[k] === "number" && (!before || Math.round(before[k] as number) !== Math.round(t[k] as number))).map(([k, label, unit]) =>
        change(label, before ? `${n(before[k] as number)} ${unit}` : null, `${n(t[k] as number)} ${unit}`),
      );
      return { title: "Objetivos de comida actualizados", tab: "dieta", group: "targets", lines: lines.length ? lines : [`${n(t.kcal)} kcal · ${n(t.protein)} g proteína`] };
    },
  },
  save_dish: { format: (d: SavedDish) => ({ title: "Platillo guardado", tab: "dieta", lines: [`${d.name} · ${n(d.macros.kcal)} kcal`] }) },
  log_water: {
    format: (r: { entry: WaterEntry; totalMl: number; goalMl: number }) => ({
      title: "Agua registrada",
      tab: "dieta",
      lines: [
        `+${n(r.entry.amountMl)} ml`,
        `${(r.totalMl / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} de ${(r.goalMl / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} L hoy`,
      ],
      revert: r.entry.id ? { kind: "water", id: r.entry.id } : undefined,
    }),
  },
  create_program: { format: (p: Program) => ({ title: "Programa creado", tab: "entreno", lines: [`${p.name} · ${days(p.days.length)}`] }) },
  log_session: {
    format: (s: SessionSaved) => ({
      title: "Sesión registrada",
      tab: "entreno",
      lines: [s.session.name, s.prs.length ? (s.prs.length === 1 ? "1 récord" : `${s.prs.length} récords`) : null],
    }),
  },
  edit_program_days: {
    before: (input: { days?: { dayId?: string }[] }) => snapshotProgramDays(input?.days?.flatMap((d) => (d.dayId ? [d.dayId] : []))),
    format: (c: ProgramChange, _input, before: ProgramDaysSnapshot | undefined) =>
      programChangeCard(c.scope === "today" ? (c.days?.length === 1 ? "Día cambiado solo para hoy" : "Días cambiados solo para hoy") : "Programa actualizado", c, before),
  },
  swap_program_exercise: {
    before: () => snapshotProgramDays(),
    format: (r: ProgramChange & { to: string }, _input, before: ProgramDaysSnapshot | undefined) =>
      programChangeCard(r.scope === "today" ? "Ejercicio cambiado solo hoy" : "Ejercicio cambiado en el programa", r, before, [r.to]),
  },
  set_training_preferences: { format: () => ({ title: "Preferencias de entreno guardadas", tab: "entreno" }) },
  edit_live_session: { format: (r: { changes: string[] }) => ({ title: "Sesión cambiada", tab: "entreno", lines: r.changes }) },
  add_medication: {
    format: (m: Medication) => ({
      title: m.kind === "suplemento" ? "Suplemento añadido" : "Medicamento añadido",
      tab: "hoy",
      place: "medicacion",
      lines: [doseOf(m), describeSchedule(m.schedule), m.instructions],
      revert: { kind: "medication_added", id: m.id },
    }),
  },
  update_medication: {
    before: (input: { id?: string }) => {
      try {
        return input?.id ? getMedication(input.id) : undefined;
      } catch {
        return undefined;
      }
    },
    format: updateMedicationCard,
  },
  log_dose: {
    // Whether that slot already had an event, which this log overwrites.
    before: (input: { medicationId?: string; date?: string; scheduledTime?: string | null }) => {
      if (!input?.medicationId || !input.scheduledTime) return false;
      const date = input.date ?? localNow().date;
      return dosesBetween(date, date, input.medicationId).some((d) => d.scheduledTime === input.scheduledTime);
    },
    format: doseCard,
  },
  set_body_goal: {
    format: (r: { goal?: BodyGoal; cleared?: string }) => {
      const [label, unit] = METRICS[r.goal?.metric ?? r.cleared ?? ""] ?? ["Meta", ""];
      return r.goal
        ? { title: "Meta guardada", tab: "cuerpo", lines: [`${label}: ${r.goal.target} ${unit}`.trim()] }
        : { title: "Meta borrada", tab: "cuerpo", lines: [label] };
    },
  },
  add_body_scan: { format: (s: { weight?: number | null }) => ({ title: "Medición guardada", tab: "cuerpo", lines: [s.weight ? `${s.weight} kg` : null] }) },
  set_sleep_target: { format: (t: { targetMin: number }) => ({ title: "Objetivo de sueño actualizado", tab: "hoy", lines: [`${t.targetMin / 60} h por noche`] }) },
  log_sleep: {
    format: (n: ManualSleepNight) =>
      n?.id ? { title: "Noche registrada", tab: "hoy", lines: [sleepSpan(n), n.note], revert: { kind: "sleep_added", id: n.id } } : null,
  },
  update_sleep_night: {
    before: (input: { id?: string; night?: string }) => {
      try {
        return input?.id ? getManualNight(input.id) : input?.night ? manualNightOn(input.night) : undefined;
      } catch {
        return undefined;
      }
    },
    format: (n: ManualSleepNight, _input, before: ManualSleepNight | undefined) => {
      if (!n?.id) return null;
      return {
        title: "Noche corregida",
        tab: "hoy",
        lines: [change(null, before && sleepSpan(before), sleepSpan(n)), before?.note !== n.note && change("Nota", before?.note, n.note ?? "Borrada")],
        revert: before ? { kind: "sleep", id: n.id, patch: { start: before.start, end: before.end, tzOffsetMin: before.tzOffsetMin, note: before.note } } : undefined,
      };
    },
  },
  delete_sleep_night: {
    format: (n: ManualSleepNight) => (n?.id ? { title: "Noche borrada", tab: "hoy", lines: [sleepSpan(n)], revert: { kind: "sleep_deleted", night: n } } : null),
  },
};

/** Titles for write tools without a formatter; their card shows the result's own summary or name. */
const TITLES: Record<string, string> = {
  delete_meal: "Comida borrada",
  set_water_goal: "Meta de agua actualizada",
  set_meal_times: "Horarios de comida guardados",
  create_recipe: "Receta creada",
  update_dish: "Platillo actualizado",
  delete_dish: "Platillo borrado",
  plan_training_week: "Semana de entreno planificada",
  update_planned_session: "Sesión planificada cambiada",
  set_session_adjustment: "Próxima sesión ajustada",
  set_exercise_unit: "Unidad cambiada",
  set_availability: "Disponibilidad guardada",
  add_busy_block: "Añadido al calendario",
  update_busy_block: "Calendario actualizado",
  remove_busy_block: "Quitado del calendario",
  add_health_event: "Evento de salud registrado",
  update_health_event: "Evento de salud actualizado",
  generate_shopping_list: "Lista de compras creada",
  add_shopping_items: "Añadido a la lista de compras",
  update_shopping_item: "Lista de compras actualizada",
  check_shopping_items: "Lista de compras actualizada",
  remove_shopping_items: "Quitado de la lista de compras",
  create_substance: "Sustancia añadida",
  log_substance_use: "Consumo registrado",
  delete_substance_use: "Consumo borrado",
  set_substance_goal: "Límite semanal guardado",
};

/** The tab a tool's domain lives in, from words in its name. */
function tabOf(name: string): AgentResultTab {
  if (/workout|training|exercise|program|session|planned/.test(name)) return "entreno";
  if (/meal|food|diet|plan|targets|water|dish|recipe|prep|slot|shopping/.test(name)) return "dieta";
  if (/body|scan|weight/.test(name)) return "cuerpo";
  return "hoy";
}

function fallback(name: string, result: unknown): Card {
  const r = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  const line = [r.summary, r.name, r.title].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  // The shopping list is one thing: several edits to it in a row are one change.
  return { title: TITLES[name] ?? "Cambio guardado", tab: tabOf(name), lines: [line], group: /shopping/.test(name) ? "shopping" : undefined };
}

const toLine = (line: Line): AgentActionLine | null =>
  !line ? null : typeof line === "string" ? (line.trim() ? { label: null, before: null, value: cut(line.trim()) } : null) : line;

const lineText = (l: AgentActionLine) => `${l.label ? `${l.label}: ` : ""}${l.before ? `${l.before} → ` : ""}${l.value}`;

function toAction(card: Card): Action {
  const lines = (card.lines ?? []).map(toLine).filter((l): l is AgentActionLine => l !== null);
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), { label: null, before: null, value: `y ${lines.length - MAX_LINES + 1} cambios más` }] : lines;
  const result: AgentToolResult = { title: card.title, detail: shown.length ? shown.map(lineText).join(" · ") : null, tab: card.tab, lines: shown };
  if (card.place) result.place = card.place;
  if (card.group) result.group = card.group;
  if (card.revert) result.undo = "available";
  return card.revert ? { card: result, revert: card.revert } : { card: result };
}

/** Built-ins (web search, scratch notes) and unknown tools are quiet; classified write tools are actions. */
export const isWrite = (name: string): boolean => classified(name) && accessOf(name) === "write";

/** What the tool is about to change, for before → after; undefined when the tool has no snapshot. Never throws. */
export function snapshotBefore(name: string, input: unknown): unknown {
  try {
    return ACTIONS[name]?.before?.(input);
  } catch {
    return undefined;
  }
}

/** The tool_result's text: a string or an array of content blocks. */
function resultText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((b) => (b && typeof b === "object" && b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");
  return text || null;
}

/**
 * The action card for a successful write tool, from its input, its result (the
 * tool_result content, or `card`: the full value the tool kept for it in
 * ./model-results.ts) and what `snapshotBefore` read; null for reads.
 */
export function summarizeAction(name: string, input: unknown, content: unknown, before?: unknown, card?: { value: unknown }): Action | null {
  if (!isWrite(name)) return null;
  let result: unknown;
  if (card) result = card.value;
  else {
    const text = resultText(content);
    try {
      result = text === null ? undefined : JSON.parse(text);
    } catch {
      result = text;
    }
  }
  const entry = ACTIONS[name];
  if (entry) {
    try {
      const card = entry.format(result, input ?? {}, before);
      if (card) return toAction(card);
      if (result && typeof result === "object" && "preview" in result) return null;
    } catch {}
  }
  return toAction(fallback(name, result));
}
