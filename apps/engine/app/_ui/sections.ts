import { Apple, CalendarDays, Dumbbell, Moon, PersonStanding, Pill, Settings, Sparkles, Sun, type LucideIcon } from "lucide-react";

/**
 * The app's sections, in sidebar order. ⌘1…⌘9 follow this order (keep it at nine or fewer). Adding a
 * section: one entry here and a folder under app/(app)/ (see WEB.md).
 * `tab` marks the four that live in the phone's bottom bar; the rest go under «Más».
 * `group` is the sidebar heading it sits under, in GROUPS order; without one it sits at the foot,
 * next to Buscar. `hidden` sections are routable but never listed (no sidebar row, tab or shortcut).
 */
export type SectionGroup = "hoy" | "mover" | "salud";
export type Section = { href: string; label: string; icon: LucideIcon; tab?: boolean; color: string; group?: SectionGroup; hidden?: boolean };

export const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "hoy", label: "Tu día" },
  { id: "mover", label: "Entrenar y comer" },
  { id: "salud", label: "Salud" },
];

const ALL: Section[] = [
  { href: "/", label: "Hoy", icon: Sun, tab: true, color: "var(--pulso-rose)", group: "hoy" },
  { href: "/coach", label: "Coach", icon: Sparkles, tab: true, color: "var(--pulso-violet)", group: "hoy" },
  { href: "/entreno", label: "Entreno", icon: Dumbbell, tab: true, color: "var(--domain-training)", group: "mover" },
  { href: "/dieta", label: "Dieta", icon: Apple, tab: true, color: "var(--domain-protein)", group: "mover" },
  { href: "/calendario", label: "Calendario", icon: CalendarDays, color: "var(--domain-fat)", group: "mover" },
  { href: "/cuerpo", label: "Cuerpo", icon: PersonStanding, color: "var(--domain-body)", group: "salud" },
  { href: "/sueno", label: "Sueño", icon: Moon, color: "var(--domain-sleep)", group: "salud" },
  { href: "/medicacion", label: "Medicación", icon: Pill, color: "var(--domain-medication)", group: "salud" },
  { href: "/ajustes", label: "Ajustes", icon: Settings, color: "var(--muted-foreground)" },
];

/** The listed sections, in visual order: grouped ones by GROUPS, then the ungrouped foot. ⌘n is index n-1 here. */
export const SECTIONS: Section[] = [...GROUPS.flatMap((g) => ALL.filter((s) => !s.hidden && s.group === g.id)), ...ALL.filter((s) => !s.hidden && !s.group)];

export const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

export const sectionFor = (pathname: string) => ALL.find((s) => isActive(s.href, pathname));
