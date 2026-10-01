import type { AgentToolResult, BodyGoal, DayAdjustment, DietPlan, MealEntry, Medication, NutritionTargets, Program, SessionSaved, WaterEntry } from "@pulso/contract";

type Summary = (value: any) => AgentToolResult | null;

const n = (value: number) => Math.round(value).toLocaleString("es-ES");
const days = (count: number) => (count === 1 ? "1 día" : `${count} días`);
const METRICS: Record<string, [string, string]> = {
  weight: ["Peso", "kg"],
  bodyFatMass: ["Grasa", "kg"],
  skeletalMuscleMass: ["Músculo", "kg"],
  percentBodyFat: ["Grasa", "%"],
};

/** Tools whose result the person will want to open, keyed by tool name (no `mcp__pulso__` prefix). */
const SUMMARIES: Record<string, Summary> = {
  create_program: (p: Program) => ({ title: "Programa creado", detail: `${p.name} · ${days(p.days.length)}`, tab: "entreno" }),
  log_session: (s: SessionSaved) => ({
    title: "Sesión registrada",
    detail: s.prs.length ? `${s.session.name} · ${s.prs.length === 1 ? "1 récord" : `${s.prs.length} récords`}` : s.session.name,
    tab: "entreno",
  }),
  create_diet_plan: (p: DietPlan) => ({ title: "Plan de comidas creado", detail: `${p.name} · ${days(p.days.length)}`, tab: "dieta" }),
  set_targets: (t: NutritionTargets) => ({ title: "Objetivos de comida actualizados", detail: `${n(t.kcal)} kcal · ${n(t.protein)} g proteína`, tab: "dieta" }),
  log_meal: (entries: MealEntry[]) => ({
    title: entries[0]?.offPlan ? "Comida fuera del plan registrada" : "Comida registrada",
    detail: [
      entries[0]?.note ?? (entries.length === 1 ? entries[0]!.name : `${entries.length} alimentos`),
      `${n(entries.reduce((sum, e) => sum + e.kcal, 0))} kcal`,
      typeof entries[0]?.eatenAt === "number" ? new Date(entries[0].eatenAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tab: "dieta",
  }),
  // The summary already says what changed and where the day ends.
  adjust_day_plan: (a: DayAdjustment & { stored: boolean }) => ({ title: a.stored ? "Plan de hoy ajustado" : "Sin comidas por ajustar", detail: a.summary, tab: "dieta" }),
  log_water: (r: { entry: WaterEntry; totalMl: number; goalMl: number }) => ({
    title: "Agua registrada",
    detail: `+${n(r.entry.amountMl)} ml · ${(r.totalMl / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} de ${(r.goalMl / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} L hoy`,
    tab: "dieta",
  }),
  add_medication: (m: Medication) => ({ title: m.kind === "suplemento" ? "Suplemento añadido" : "Medicamento añadido", detail: `${m.name} · ${m.dose} ${m.unit}`, tab: "hoy" }),
  update_medication: (m: Medication) => ({ title: "Medicación actualizada", detail: m.name, tab: "hoy" }),
  set_body_goal: (r: { goal?: BodyGoal; cleared?: string }) => {
    const [label, unit] = METRICS[r.goal?.metric ?? r.cleared ?? ""] ?? ["Meta", ""];
    return r.goal ? { title: "Meta guardada", detail: `${label}: ${r.goal.target} ${unit}`.trim(), tab: "cuerpo" } : { title: "Meta borrada", detail: label, tab: "cuerpo" };
  },
  add_body_scan: (s: { weight?: number | null }) => ({ title: "Medición guardada", detail: s.weight ? `${s.weight} kg` : null, tab: "cuerpo" }),
  set_sleep_target: (t: { targetMin: number }) => ({ title: "Objetivo de sueño actualizado", detail: `${t.targetMin / 60} h por noche`, tab: "hoy" }),
};

/** The tool_result's text: a string or an array of content blocks. */
function resultText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((b) => (b && typeof b === "object" && b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");
  return text || null;
}

/**
 * A short card for a successful tool that changed something the app shows, or
 * null. Never throws: an unexpected shape just means no card.
 */
export function summarizeResult(name: string, content: unknown): AgentToolResult | null {
  const summary = SUMMARIES[name];
  const text = summary && resultText(content);
  if (!text) return null;
  try {
    return summary(JSON.parse(text));
  } catch {
    return null;
  }
}
