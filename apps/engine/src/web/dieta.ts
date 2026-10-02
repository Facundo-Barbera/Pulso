/**
 * What the web app's Dieta pages draw, assembled from the nutrition, water and
 * shopping stores. The page and `GET /api/web/dieta/day` share `dietaDay`, so a
 * server render and a client refresh see the same shape. The few writes the
 * phone does not need (editing an entry, eating several plan items at once)
 * live here too, built on the store's own functions.
 */
import type { DailySummary, FrequentFood, MealEntry, MealInput, MealSlot, NutritionTargets, PlanDay, PlanItem, SavedDish, WaterDay } from "@pulso/contract";
import { MEAL_SLOTS } from "@pulso/contract";
import { db } from "../db";
import { addDays, localDate } from "../nutrition/dates";
import { slotViews } from "../nutrition/horizon";
import { dishName, dishPosition, joinDish } from "../nutrition/dishes";
import { untie } from "../nutrition/reconcile";
import { findSlotRow } from "../nutrition/slots";
import {
  activePlan,
  deleteMeal,
  eatPlanItem,
  frequentFoods,
  getAdjustment,
  listMeals,
  logMeal,
  logMeals,
  nutritionDay,
  planDayIndex,
  summaries,
} from "../nutrition/store";
import { waterDay, waterTotals } from "../nutrition/water";

export const SLOT_LABELS: Record<MealSlot, string> = {
  desayuno: "Desayuno",
  media_manana: "Media mañana",
  comida: "Comida",
  merienda: "Merienda",
  cena: "Cena",
  snack: "Snack",
};

/** A logged entry with its engine-local clock time, so the browser's timezone never moves it. */
export type DietaEntry = MealEntry & { time: string };

/** One dot on the day's timeline: a meal slot, or one snack (snacks more than 45 min apart are separate moments). */
export type Moment = {
  id: string;
  slot: MealSlot;
  /** "Comida", "Snack", or "Bebida" for a snack made only of drinks. */
  title: string;
  drink: boolean;
  time: string;
  note: string | null;
  kcal: number;
  entries: DietaEntry[];
};

export type PlanItemView = PlanItem & { /** The log entry that ate it, when eaten. */ entryId: string | null };

/** A plan meal as it should be eaten: the Coach's adjustment laid over the plan. */
export type PlanMealView = {
  slot: MealSlot;
  title: string;
  name: string | null;
  /** How the Coach changed it today; null when untouched. */
  change: "scaled" | "swapped" | null;
  kcal: number;
  items: PlanItemView[];
  done: boolean;
};

export type DietaPlan = {
  id: string;
  name: string;
  notes: string | null;
  /** Which plan day applies on the date. */
  dayIndex: number;
  dayLabel: string;
  /** The date's meals, adjusted and with eaten marks. */
  meals: PlanMealView[];
  eaten: number;
  total: number;
  adjustment: { summary: string; note: string | null; createdAt: number } | null;
  /** Every day of the plan as written, for browsing. */
  days: { label: string; kcal: number; meals: PlanMealView[] }[];
};

export type DietaDay = {
  date: string;
  today: string;
  summary: DailySummary;
  moments: Moment[];
  plan: DietaPlan | null;
  /** The first planned meal with nothing logged in its slot yet. */
  next: PlanMealView | null;
  water: WaterDay;
  /** Foods logged most in the last 60 days, for search and one-tap add. */
  frequent: FrequentFood[];
  /** Saved dishes (Mis platillos), most used first: offered before frequent foods. */
  dishes: SavedDish[];
};

const SNACK_GAP_MS = 45 * 60_000;
const clock = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
export const timeOf = (ms: number) => clock.format(ms);
const kcalOf = (items: { kcal: number }[]) => Math.round(items.reduce((sum, i) => sum + i.kcal, 0));

/** Groups the day's entries into timeline moments, in eating order. */
export function moments(meals: MealEntry[]): Moment[] {
  const groups: { slot: MealSlot; entries: MealEntry[] }[] = [];
  for (const meal of [...meals].sort((a, b) => a.eatenAt - b.eatenAt)) {
    const group = groups.findLast((g) => g.slot === meal.slot);
    if (group && (meal.slot !== "snack" || meal.eatenAt - group.entries.at(-1)!.eatenAt <= SNACK_GAP_MS)) group.entries.push(meal);
    else groups.push({ slot: meal.slot, entries: [meal] });
  }
  return groups.map(({ slot, entries }) => {
    const drink = entries.every((e) => e.unit === "ml");
    return {
      id: `${slot}-${entries[0]!.id}`,
      slot,
      title: slot === "snack" && drink ? "Bebida" : SLOT_LABELS[slot],
      drink,
      time: timeOf(entries[0]!.eatenAt),
      note: entries.find((e) => e.note)?.note ?? null,
      kcal: kcalOf(entries),
      entries: entries.map((e) => ({ ...e, time: timeOf(e.eatenAt) })),
    };
  });
}

function mealView(slot: MealSlot, name: string | null, items: PlanItem[], change: PlanMealView["change"], eatenBy: Map<string, string>): PlanMealView {
  const views = items.map((i) => ({ ...i, entryId: eatenBy.get(i.id) ?? null }));
  return { slot, title: SLOT_LABELS[slot], name, change, kcal: kcalOf(items), items: views, done: views.length > 0 && views.every((i) => i.entryId) };
}

/** A plan day's meals in slot order, with the adjustment's meals replacing the planned ones. */
export function planMeals(day: PlanDay, adjusted: { slot: MealSlot; name: string | null; items: PlanItem[]; change: string }[] = [], eatenBy = new Map<string, string>()): PlanMealView[] {
  const bySlot = new Map<MealSlot, PlanMealView>();
  for (const m of day.meals) if (!bySlot.has(m.slot)) bySlot.set(m.slot, mealView(m.slot, m.name, m.items, null, eatenBy));
  for (const m of adjusted) {
    const change = m.change === "scaled" || m.change === "swapped" ? m.change : null;
    bySlot.set(m.slot, mealView(m.slot, m.name ?? bySlot.get(m.slot)?.name ?? null, m.items, change, eatenBy));
  }
  return MEAL_SLOTS.flatMap((s) => bySlot.get(s) ?? []);
}

export function dietaDay(date: string, today = localDate()): DietaDay {
  const day = nutritionDay(date);
  const eatenBy = new Map(day.meals.flatMap((m) => (m.planItemId ? [[m.planItemId, m.id] as const] : [])));
  let plan: DietaPlan | null = null;
  if (day.plan) {
    const { plan: p, dayIndex, day: planDay, adjustment } = day.plan;
    const meals = planMeals(planDay, adjustment?.meals, eatenBy);
    const items = meals.flatMap((m) => m.items);
    plan = {
      id: p.id,
      name: p.name,
      notes: p.notes,
      dayIndex,
      dayLabel: planDay.label,
      meals,
      eaten: items.filter((i) => i.entryId).length,
      total: items.length,
      adjustment: adjustment && { summary: adjustment.summary, note: adjustment.note, createdAt: adjustment.createdAt },
      days: p.days.map((d) => {
        const dayMeals = planMeals(d);
        return { label: d.label, kcal: kcalOf(dayMeals), meals: dayMeals };
      }),
    };
  }
  const logged = new Set(day.meals.map((m) => m.slot));
  return {
    date,
    today,
    summary: day.summary,
    moments: moments(day.meals),
    plan,
    next: plan?.meals.find((m) => !logged.has(m.slot) && !m.done) ?? null,
    water: day.water,
    frequent: frequentFoods(40, today),
    dishes: day.dishes,
  };
}

export type ProgressDay = {
  date: string;
  kcal: number;
  protein: number;
  entries: number;
  waterMl: number;
  /** In zone: something logged, kcal in its zone and protein at least its minimum (DailySummary.inZone). */
  onTarget: boolean;
  /** Share of the active plan's items eaten that day (0–1); null before the plan started or without one. */
  planShare: number | null;
};

export type DietaProgress = {
  days: ProgressDay[];
  targets: NutritionTargets | null;
  waterGoalMl: number;
  /** Means over the days with something logged (water: days with water). */
  averages: { kcal: number | null; protein: number | null; waterMl: number | null; plan: number | null; onTarget: number; logged: number };
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);


/** The last `count` days ending `today`: kcal, protein, water and how much of the plan was followed. */
export function dietaProgress(today = localDate(), count = 14): DietaProgress {
  const from = addDays(today, 1 - count);
  const days = summaries(from, today);
  const water = waterTotals(from, today);
  const plan = activePlan();
  const planFrom = plan ? [plan.startsOn, localDate(plan.createdAt)].sort()[1]! : null;
  const meals = plan ? listMeals(from, today) : [];

  const out: ProgressDay[] = days.map((s) => {
    let planShare: number | null = null;
    if (plan && planFrom && s.date >= planFrom) {
      const adjustment = getAdjustment(s.date, plan.id);
      const items = planMeals(plan.days[planDayIndex(plan, s.date)]!, adjustment?.meals).flatMap((m) => m.items);
      const eaten = new Set(meals.filter((m) => m.date === s.date && m.planItemId).map((m) => m.planItemId));
      planShare = items.length ? items.filter((i) => eaten.has(i.id)).length / items.length : null;
    }
    return { date: s.date, kcal: s.totals.kcal, protein: s.totals.protein, entries: s.entries, waterMl: water[s.date] ?? 0, onTarget: s.inZone, planShare };
  });

  const logged = out.filter((d) => d.entries > 0);
  const shares = out.flatMap((d) => (d.planShare === null || d.date === today ? [] : [d.planShare]));
  return {
    days: out,
    targets: days.at(-1)?.targets ?? null,
    waterGoalMl: waterDay(today).goalMl,
    averages: {
      kcal: mean(logged.map((d) => d.kcal)),
      protein: mean(logged.map((d) => d.protein)),
      waterMl: mean(out.filter((d) => d.waterMl > 0).map((d) => d.waterMl)),
      plan: mean(shares),
      onTarget: out.filter((d) => d.onTarget).length,
      logged: logged.length,
    },
  };
}

/** One entry by id. */
export function mealById(id: string): MealEntry | undefined {
  const row = db().query<{ date: string }, [string]>("SELECT date FROM meal_entries WHERE id = ?").get(id);
  return row ? listMeals(row.date).find((m) => m.id === id) : undefined;
}

/**
 * Rewrites an entry with what the person corrected (name, amount, macros, slot,
 * time). Where it came from — source, plan item, barcode, note — stays, and so
 * does the meal it was tied to while it stays the same meal on the same day;
 * otherwise it is reconciled again. A dish's component stays in its place, at
 * the dish's time and meal. The entry gets a new id. Undefined when it does not exist.
 */
export function replaceMeal(id: string, input: MealInput): MealEntry | undefined {
  return db().transaction(() => {
    const old = mealById(id);
    if (!old) return undefined;
    const position = dishPosition(id);
    if (old.dish) input = { ...input, slot: old.slot, eatenAt: old.eatenAt, date: old.date };
    // deleteMeal drops a dish left empty; one replaced in place must outlive it.
    if (old.dish) {
      untie([id]);
      db().query("DELETE FROM meal_entries WHERE id = ?").run(id);
    } else deleteMeal(id);
    const meal = logMeal({
      ...input,
      barcode: old.barcode,
      planItemId: old.planItemId,
      slotId: old.slotId && input.slot === old.slot && (input.date ?? old.date) === old.date ? old.slotId : null,
      offPlan: old.offPlan,
      note: input.note === undefined ? old.note : input.note,
    }, old.source);
    if (!old.dish) return meal;
    joinDish(old.dish.id, [meal.id], position ?? undefined);
    return mealById(meal.id);
  })();
}

/**
 * «Me lo comí» for one dated slot: logs what it holds now (the Coach's adjusted
 * portions when there are) tied to that slot. Batch portions can share an item
 * id across slots, so eating by slot is the only unambiguous way. Nothing when
 * the slot is unknown or no longer planned.
 */
export function eatSlot(slotId: string): MealEntry[] {
  const row = findSlotRow(slotId);
  const slot = row && slotViews([row])[0];
  if (!slot || slot.status !== "planned") return [];
  const items = slot.adjusted ?? slot.items;
  // Several foods are one dish, named as the plan names the meal.
  const dish = items.length > 1 ? { name: slot.name ?? dishName(items) } : undefined;
  return logMeals(items.map(({ id, ...food }) => ({ ...food, slot: slot.slot, date: slot.date, planItemId: id, slotId })), "plan", dish);
}

/** "Comí lo del plan": logs each item of the active plan not yet eaten on `date`. Unknown ids are skipped. */
export function eatPlanItems(itemIds: string[], date: string): MealEntry[] {
  return db().transaction(() => {
    const eaten = new Set(listMeals(date).map((m) => m.planItemId));
    return itemIds.flatMap((id) => (eaten.has(id) ? [] : (eatPlanItem(id, date) ?? [])));
  })();
}
