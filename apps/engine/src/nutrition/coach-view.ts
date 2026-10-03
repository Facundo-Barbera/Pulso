/**
 * The dated diet plan as the Coach reads it: one line per meal, ids kept for
 * the plan tools. Every result stays in the Coach's context for later turns,
 * so the tools return these instead of the full slots the Dieta tab draws.
 */
import type { DietDay, DietHorizon, Macros, PlanChange, PlanItem, PlanSlot, PrepBatch } from "@pulso/contract";
import type { UnavailablePreview } from "./ops";

const r = (n: number) => Math.round(n);
const amount = (n: number) => `${Math.round(n * 10) / 10}`;

/** "2.100 kcal · 150 P · 200 C · 70 G". */
export const macrosText = (m: Macros) => `${r(m.kcal)} kcal · ${r(m.protein)} P · ${r(m.carbs)} C · ${r(m.fat)} G`;

const itemText = (i: PlanItem) => `${i.name} ${amount(i.quantity)} ${i.unit}`;

/**
 * `<id> · cena · «Pasta boloñesa» · Pasta 80 g, Carne picada 125 g · 640 kcal · 38 P · planned`, then
 * what happened to it: eaten / replaced by / real meal / sin registrar, cooking minutes, note.
 */
export function slotLine(s: PlanSlot): string {
  const what =
    s.kind === "recipe"
      ? `receta ${s.recipeId} × ${s.portions}`
      : s.kind === "prep"
        ? `tanda ${s.prepId} × ${s.portions}`
        : `${(s.adjusted ?? s.items).map(itemText).join(", ")}${s.adjusted ? " (ajustado)" : ""}`;
  return [
    s.id,
    s.slot,
    s.name && `«${s.name}»`,
    s.kind === "eat_out" ? "comer fuera" : what,
    `${r(s.macros.kcal)} kcal · ${r(s.macros.protein)} P`,
    s.status + (s.missed ? " (sin registrar)" : ""),
    s.replacedBy && `en su lugar: ${s.replacedBy}`,
    s.real && `real: ${s.real.label} · ${r(s.real.macros.kcal)} kcal${s.real.asPlanned ? " (como el plan)" : ""} [${s.real.entryIds.join(", ")}]`,
    s.cookMinutes ? `${s.cookMinutes} min de cocina` : null,
    s.note && `«${s.note}»`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const dayForCoach = (d: DietDay) => ({
  date: d.date,
  label: d.label,
  goalKcal: r(d.goalKcal),
  shiftKcal: d.shiftKcal ? r(d.shiftKcal) : null,
  planned: macrosText(d.planned),
  real: d.real.kcal ? macrosText(d.real) : null,
  extraIds: d.extraIds,
  adjustment: d.adjustment?.summary,
  slots: d.slots.map(slotLine),
});

/** `<id> · Pollo al curry (receta <id>) · cocinar 2026-10-04 · 4 raciones: 1 asignada, 3 libres · planned`. */
const prepLine = (p: PrepBatch) =>
  `${p.id} · ${p.recipeName} (receta ${p.recipeId}) · cocinar ${p.cookDate} · ${p.portions} raciones: ${p.slotIds.length} asignadas, ${p.eaten} comidas, ${p.leftover} libres · ${p.status}`;

export function horizonForCoach(h: DietHorizon | null) {
  if (!h) return null;
  return {
    planId: h.planId,
    planName: h.planName,
    from: h.from,
    to: h.to,
    horizonDays: h.horizonDays,
    days: h.days.map(dayForCoach),
    preps: h.preps.map(prepLine),
    lastRevision: h.lastRevision && { id: h.lastRevision.id, op: h.lastRevision.op, summary: h.lastRevision.summary },
  };
}

const isChange = (v: unknown): v is PlanChange => !!v && typeof v === "object" && "revision" in v && "slots" in v;
const isPreview = (v: unknown): v is UnavailablePreview => !!v && typeof v === "object" && "preview" in v && "affected" in v;

const MAX_SLOTS = 20;

/**
 * A plan change for the Coach: its summary and revision, the touched meals as
 * lines (those `relevant` keeps, at most MAX_SLOTS), the compensation in a line
 * per day. Other values pass through.
 */
export function planResultForCoach(v: unknown, relevant: (s: PlanSlot) => boolean = () => true): unknown {
  if (isPreview(v)) return { preview: true, ingredient: v.ingredient, summary: v.summary, affected: v.affected.map(slotLine) };
  if (!isChange(v)) return v;
  const { revision, summary, slots, compensation, shoppingRefreshed, ...rest } = v as PlanChange & { adjustment?: { summary: string } };
  const shown = slots.filter(relevant);
  return {
    summary,
    revisionId: revision.id,
    slots: shown.slice(0, MAX_SLOTS).map(slotLine),
    ...(shown.length > MAX_SLOTS ? { moreSlots: `${shown.length - MAX_SLOTS} más: get_diet_horizon los tiene` } : {}),
    compensation: compensation && {
      summary: compensation.summary,
      unabsorbedKcal: r(compensation.unabsorbedKcal),
      days: compensation.days.map((d) => `${d.date}: ${d.shiftKcal > 0 ? "+" : ""}${r(d.shiftKcal)} kcal`),
    },
    shoppingRefreshed,
    ...("adjustment" in rest && rest.adjustment ? { adjustment: rest.adjustment.summary } : {}),
  };
}
