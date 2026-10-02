import type { AgentResultPlace, AgentResultTab, AgentToolResult, AgentToolUse } from "@pulso/contract";
import { Apple, BookOpen, CalendarDays, Dumbbell, FileText, Globe, HeartPulse, Moon, NotebookPen, PersonStanding, Pill, Search, ShoppingCart, Sparkles, Sun, UserRound, type LucideIcon } from "lucide-react";

export type ToolLook = { label: string; icon: LucideIcon; color: string };

const WRITES = /^(log|add|create|update|save|set|delete|remove|plan|adjust|generate|check)_/;

const EXACT: Record<string, ToolLook> = {
  get_profile: { label: "Leyendo tu perfil", icon: UserRound, color: "var(--primary)" },
  update_profile: { label: "Actualizando tu perfil", icon: UserRound, color: "var(--primary)" },
  get_latest_brief: { label: "Releyendo tu resumen", icon: Sparkles, color: "var(--pulso-violet)" },
  WebSearch: { label: "Buscando en la web", icon: Search, color: "var(--muted-foreground)" },
  WebFetch: { label: "Leyendo una página", icon: Globe, color: "var(--muted-foreground)" },
  Read: { label: "Revisando sus notas", icon: BookOpen, color: "var(--muted-foreground)" },
  Write: { label: "Tomando notas", icon: NotebookPen, color: "var(--muted-foreground)" },
};

/** Domains in the order they are tried: the first whose words appear in the tool's name wins. */
const DOMAINS: { words: string[]; icon: LucideIcon; color: string; read: string; write: string }[] = [
  { words: ["shopping"], icon: ShoppingCart, color: "var(--domain-carbs)", read: "Revisando tu lista de compras", write: "Actualizando tu lista de compras" },
  { words: ["sleep"], icon: Moon, color: "var(--domain-sleep)", read: "Revisando tu sueño", write: "Ajustando tu objetivo de sueño" },
  { words: ["medication", "dose"], icon: Pill, color: "var(--domain-medication)", read: "Revisando tu medicación", write: "Actualizando tu medicación" },
  { words: ["calendar", "busy", "availability", "health_event"], icon: CalendarDays, color: "var(--domain-fat)", read: "Mirando tu calendario", write: "Actualizando tu calendario" },
  { words: ["workout", "training", "exercise", "program", "session", "loads", "planned"], icon: Dumbbell, color: "var(--domain-training)", read: "Revisando tus entrenamientos", write: "Actualizando tu entrenamiento" },
  { words: ["meal", "food", "diet", "plan", "targets", "water", "adherence", "day_plan"], icon: Apple, color: "var(--domain-carbs)", read: "Revisando tu alimentación", write: "Actualizando tu alimentación" },
  { words: ["body", "scan", "weight", "projection"], icon: PersonStanding, color: "var(--domain-body)", read: "Revisando tu composición corporal", write: "Guardando tus medidas" },
  { words: ["metric", "readiness", "daily", "summary", "heart", "hrv"], icon: HeartPulse, color: "var(--domain-protein)", read: "Revisando tus métricas del día", write: "Guardando tus métricas" },
];

/** What the Coach is doing with a tool, in the person's words (as on iOS: CoachToolLabel). */
export function toolLook(name: string): ToolLook {
  const exact = EXACT[name];
  if (exact) return exact;
  const writes = WRITES.test(name);
  const domain = DOMAINS.find((d) => d.words.some((w) => name.includes(w)));
  if (domain) return { label: writes ? domain.write : domain.read, icon: domain.icon, color: domain.color };
  return { label: writes ? "Guardando cambios" : "Consultando tus datos", icon: FileText, color: "var(--primary)" };
}

export type ResultPlace = { name: string; href: string; icon: LucideIcon; color: string };

/** Where a tool's result lives in the web app. */
export const RESULT_PLACES: Record<AgentResultTab | AgentResultPlace, ResultPlace> = {
  hoy: { name: "Hoy", href: "/", icon: Sun, color: "var(--domain-energy)" },
  entreno: { name: "Entreno", href: "/entreno", icon: Dumbbell, color: "var(--domain-training)" },
  dieta: { name: "Dieta", href: "/dieta", icon: Apple, color: "var(--domain-carbs)" },
  cuerpo: { name: "Cuerpo", href: "/cuerpo", icon: PersonStanding, color: "var(--domain-body)" },
  medicacion: { name: "Medicación", href: "/medicacion", icon: Pill, color: "var(--domain-medication)" },
  perfil: { name: "Perfil", href: "/cuerpo#perfil", icon: UserRound, color: "var(--domain-body)" },
};

export const placeOf = (result: AgentToolResult): ResultPlace => RESULT_PLACES[result.place ?? result.tab] ?? RESULT_PLACES.hoy;

/** A tool that changed something: it gets an action card, not a quiet chip. Older messages have no `access`. */
export const isAction = (tool: AgentToolUse) => tool.access === "write" || !!tool.result;
