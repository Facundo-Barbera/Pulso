/**
 * The living plan as the web's Dieta pages draw it: dated slots with a Spanish
 * source line ("Porción del prep · Pollo con arroz · 2 de 4"), the horizon as
 * days, prep sessions on their cook day, and the plan's changes. Reads the
 * nutrition stores; every write goes through `/api/web/dieta/plan/*`.
 */
import type { DietDay, PlanRevision, PlanSlot, PrepBatch, Recipe } from "@pulso/contract";
import { db } from "../db";
import { localDate } from "../nutrition/dates";
import { dietDay, dietHorizon, prepViews } from "../nutrition/horizon";
import { findRecipe } from "../nutrition/recipes";
import { listRevisions } from "../nutrition/revisions";
import { dayRow } from "../nutrition/slots";
import { activePlan } from "../nutrition/store";
import { SLOT_LABELS } from "./dieta";

/** Recipes that take longer than this are "cooking"; shorter ones are a «receta rápida». */
export const QUICK_MINUTES = 15;

export type SlotView = PlanSlot & {
  /** "Comida", "Cena"… */
  title: string;
  /** What fills it, in one line: the dish or the items. */
  label: string;
  /** Where it comes from: "Porción del prep · Pollo con arroz · 2 de 4", "Receta rápida · 10 min", "Comer fuera"; null for plain items. */
  source: string | null;
  kcal: number;
  /** Planned and needs cooking that day: «Hoy no cocino» applies. */
  cooks: boolean;
};

export type DayView = Omit<DietDay, "slots"> & {
  slots: SlotView[];
  /** Batches cooked on this date. */
  preps: PrepBatch[];
  kcal: number;
};

export type DietaLivingPlan = {
  today: string;
  planName: string;
  horizonDays: number;
  from: string;
  to: string;
  days: DayView[];
  preps: PrepBatch[];
  /** Recipes the horizon uses, by id, for the detail sheet. */
  recipes: Record<string, Recipe>;
  revisions: PlanRevision[];
};

/** Which portion of its batch each prep slot is, in eating order: slot id → [n, of]. */
function portionNumbers(preps: PrepBatch[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const prep of preps) {
    const ids = db()
      .query<{ id: string }, [string]>("SELECT id FROM plan_slots WHERE prep_id = ? AND kind = 'prep' AND status = 'planned' ORDER BY date, position")
      .all(prep.id)
      .map((r) => r.id);
    ids.forEach((id, i) => out.set(id, [i + 1, Math.max(prep.portions, ids.length)]));
  }
  return out;
}

export function slotView(slot: PlanSlot, preps: PrepBatch[], portions = portionNumbers(preps)): SlotView {
  const items = slot.adjusted ?? slot.items;
  const label = slot.name ?? items.map((i) => i.name).join(", ");
  let source: string | null = null;
  if (slot.kind === "prep") {
    const prep = preps.find((p) => p.id === slot.prepId);
    const n = portions.get(slot.id);
    source = ["Porción del prep", prep?.recipeName, n && `${n[0]} de ${n[1]}`].filter(Boolean).join(" · ");
  } else if (slot.kind === "recipe") {
    const minutes = slot.cookMinutes;
    source = minutes !== null && minutes <= QUICK_MINUTES ? `Receta rápida · ${minutes} min` : minutes !== null ? `Receta · ${minutes} min` : "Receta";
  } else if (slot.kind === "eat_out") source = "Comer fuera";
  return {
    ...slot,
    title: SLOT_LABELS[slot.slot],
    label: label || SLOT_LABELS[slot.slot],
    source,
    kcal: Math.round(slot.macros.kcal),
    cooks: slot.status === "planned" && slot.kind === "recipe" && (slot.cookMinutes ?? QUICK_MINUTES + 1) > QUICK_MINUTES,
  };
}

function dayView(day: DietDay, preps: PrepBatch[], portions: Map<string, [number, number]>): DayView {
  return {
    ...day,
    slots: day.slots.map((s) => slotView(s, preps, portions)),
    preps: preps.filter((p) => p.cookDate === day.date && p.status !== "discarded"),
    kcal: Math.round(day.planned.kcal),
  };
}

/** The horizon from today, ready to draw; null without an active plan. */
export function dietaLivingPlan(today = localDate(), days?: number): DietaLivingPlan | null {
  const horizon = dietHorizon(today, days);
  if (!horizon) return null;
  const portions = portionNumbers(horizon.preps);
  const out = horizon.days.map((d) => dayView(d, horizon.preps, portions));
  const recipes: Record<string, Recipe> = {};
  const ids = [...out.flatMap((d) => d.slots.map((s) => s.recipeId)), ...horizon.preps.map((p) => p.recipeId)];
  for (const id of ids) if (id && !recipes[id]) {
    const recipe = findRecipe(id);
    if (recipe) recipes[id] = recipe;
  }
  return {
    today,
    planName: horizon.planName,
    horizonDays: horizon.horizonDays,
    from: horizon.from,
    to: horizon.to,
    days: out,
    preps: horizon.preps,
    recipes,
    revisions: listRevisions(horizon.planId, 30),
  };
}

/**
 * One date's slots for the Hoy view. Today and later are laid out on first read;
 * a past date only shows when it was laid out (otherwise it never had slots).
 */
export function dietaDaySlots(date: string, today = localDate()): DayView | null {
  const plan = activePlan();
  if (!plan || (date < today && !dayRow(plan.id, date))) return null;
  const day = dietDay(plan, date);
  const preps = prepViews(plan.id).filter((p) => day.slots.some((s) => s.prepId === p.id) || p.cookDate === date);
  return dayView(day, preps, portionNumbers(preps));
}
