import { Apple, Dumbbell, Moon, PersonStanding, Pill, Settings, Sparkles, Sun, type LucideIcon } from "lucide-react";

/**
 * The app's sections, in sidebar order. ⌘1…⌘8 follow this order. Adding a
 * section: one entry here and a folder under app/(app)/ (see WEB.md).
 * `tab` marks the four that live in the phone's bottom bar; the rest go under «Más».
 */
export type Section = { href: string; label: string; icon: LucideIcon; tab?: boolean; color: string };

export const SECTIONS: Section[] = [
  { href: "/", label: "Hoy", icon: Sun, tab: true, color: "var(--pulso-rose)" },
  { href: "/coach", label: "Coach", icon: Sparkles, tab: true, color: "var(--pulso-violet)" },
  { href: "/entreno", label: "Entreno", icon: Dumbbell, tab: true, color: "var(--domain-training)" },
  { href: "/dieta", label: "Dieta", icon: Apple, tab: true, color: "var(--domain-protein)" },
  { href: "/cuerpo", label: "Cuerpo", icon: PersonStanding, color: "var(--domain-body)" },
  { href: "/sueno", label: "Sueño", icon: Moon, color: "var(--domain-sleep)" },
  { href: "/medicacion", label: "Medicación", icon: Pill, color: "var(--domain-medication)" },
  { href: "/ajustes", label: "Ajustes", icon: Settings, color: "var(--muted-foreground)" },
];

export const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

export const sectionFor = (pathname: string) => SECTIONS.find((s) => isActive(s.href, pathname));
