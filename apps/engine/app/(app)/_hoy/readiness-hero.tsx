import type { Readiness, ReadinessFactor } from "@pulso/contract";
import { Activity, HeartPulse, Moon, type LucideIcon } from "lucide-react";
import { Card } from "../../_ui/card";
import { Ring } from "../../_ui/ring";

const LEVEL: Record<Readiness["level"], { color: string; headline: string }> = {
  high: { color: "var(--success)", headline: "Listo para exigirte" },
  medium: { color: "var(--warning)", headline: "Un día normal" },
  low: { color: "var(--destructive)", headline: "Mejor ir suave" },
  unknown: { color: "var(--muted-foreground)", headline: "Todavía sin lectura" },
};

const FACTOR_ICON: Record<ReadinessFactor["key"], { icon: LucideIcon; color: string }> = {
  hrv: { icon: Activity, color: "var(--domain-heart)" },
  resting_hr: { icon: HeartPulse, color: "var(--domain-protein)" },
  sleep: { icon: Moon, color: "var(--domain-sleep)" },
};

/** The page's one hero: the readiness ring, what it means today, and the three factors behind it. */
export function ReadinessHero({ readiness }: { readiness: Readiness }) {
  const level = LEVEL[readiness.level];
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      {/* The brand, once: a faint glow in the corner. */}
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.13] blur-3xl dark:opacity-20" style={{ background: "var(--pulso-gradient)" }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:items-center md:gap-10">
        <Ring value={readiness.score} color={level.color} glow={readiness.score !== null} size={184} stroke={15} label={readiness.score === null ? "Preparación sin datos" : `Preparación ${readiness.score} de 100`}>
          <div>
            <p className="tabular text-[52px] leading-none font-semibold tracking-tight">{readiness.score ?? "—"}</p>
            <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">Preparación</p>
          </div>
        </Ring>
        <div className="w-full min-w-0 flex-1">
          <p className="text-center text-[22px] font-semibold tracking-tight md:text-left" style={{ color: readiness.level === "unknown" ? undefined : level.color }}>
            {level.headline}
          </p>
          <p className="text-muted-foreground mt-1.5 text-center text-[15px] leading-relaxed md:text-left">{readiness.explanation}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {readiness.factors.map((factor) => (
              <FactorTile key={factor.key} factor={factor} />
            ))}
          </ul>
          {readiness.baselineDays < 7 && readiness.level !== "unknown" && (
            <p className="text-muted-foreground mt-4 text-[12px]">Tu línea base se está formando ({readiness.baselineDays} de 28 días): la lectura gana precisión con el uso.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function FactorTile({ factor }: { factor: ReadinessFactor }) {
  const { icon: Icon, color } = FACTOR_ICON[factor.key];
  return (
    <li className="bg-muted/60 rounded-2xl p-3.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
        <Icon className="size-3.5" style={{ color }} strokeWidth={2.2} />
        {factor.label}
        <span className="tabular text-foreground ml-auto font-semibold">{factor.score ?? "—"}</span>
      </p>
      <div className="bg-background/70 mt-2.5 h-1.5 overflow-hidden rounded-full">
        <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${factor.score ?? 0}%`, background: color }} />
      </div>
      <p className="text-muted-foreground mt-2 text-[12px] leading-snug">{factor.detail}</p>
    </li>
  );
}
