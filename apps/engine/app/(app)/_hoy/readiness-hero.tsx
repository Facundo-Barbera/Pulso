import type { Readiness, ReadinessFactor } from "@pulso/contract";
import { Activity, CircleCheck, CircleDashed, CircleDot, HeartPulse, Moon, TriangleAlert, type LucideIcon } from "lucide-react";
import { Card } from "../../_ui/card";
import { fmtMinutes, fmtNumber } from "../../_ui/format";
import { Ring } from "../../_ui/ring";

/** Each level as colour, icon and word together: never green against red, never the colour alone. */
const LEVEL: Record<Readiness["level"], { color: string; icon: LucideIcon; word: string; headline: string }> = {
  high: { color: "var(--state-good)", icon: CircleCheck, word: "Alta", headline: "Listo para exigirte" },
  medium: { color: "var(--state-fair)", icon: CircleDot, word: "Media", headline: "Un día normal" },
  low: { color: "var(--state-caution)", icon: TriangleAlert, word: "Baja", headline: "Mejor ir suave" },
  unknown: { color: "var(--muted-foreground)", icon: CircleDashed, word: "Sin datos", headline: "Todavía sin lectura" },
};

/** From 20:00 to 5:00 the day's training window is over: the hero talks about winding down, whatever the score. */
const NIGHT_FROM = 20;
const NIGHT_UNTIL = 5;
export const isNight = (at: Date) => at.getHours() >= NIGHT_FROM || at.getHours() < NIGHT_UNTIL;

const NIGHT: Record<Exclude<Readiness["level"], "unknown">, string> = {
  high: "Hoy te recuperaste bien. Ahora toca descansar: dormir bien es lo que lo mantiene mañana.",
  medium: "Recuperación normal hoy. Lo que más suma ahora es dormir tus horas.",
  low: "Hoy venías bajo de recuperación. Acuéstate temprano: es lo que más ayuda para mañana.",
};

const FACTOR_ICON: Record<ReadinessFactor["key"], { icon: LucideIcon; color: string }> = {
  hrv: { icon: Activity, color: "var(--domain-heart)" },
  resting_hr: { icon: HeartPulse, color: "var(--domain-heart)" },
  sleep: { icon: Moon, color: "var(--domain-sleep)" },
};

/**
 * The page's one hero: the readiness ring, what it means today, and the three factors behind it.
 * `sleepMin` is last night as the Sueño card shows it, so both say the same duration.
 */
export function ReadinessHero({ readiness, sleepMin, at = new Date() }: { readiness: Readiness; sleepMin: number | null; at?: Date }) {
  const level = LEVEL[readiness.level];
  const night = isNight(at) && readiness.level !== "unknown";
  const headline = night ? "Hora de bajar el ritmo" : level.headline;
  const explanation = night ? NIGHT[readiness.level as keyof typeof NIGHT] : readiness.explanation;
  const LevelIcon = level.icon;
  return (
    <Card className="relative overflow-hidden !p-6 md:!p-8">
      {/* The brand, once: a faint glow in the corner. */}
      <div className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full opacity-[0.13] blur-3xl dark:opacity-20" style={{ background: "var(--pulso-gradient)" }} aria-hidden />
      <div className="relative flex flex-col items-center gap-7 md:flex-row md:items-center md:gap-10">
        <Ring value={readiness.score} color={level.color} glow={readiness.score !== null} size={184} stroke={15} label={readiness.score === null ? "Preparación sin datos" : `Preparación ${level.word.toLowerCase()}: ${readiness.score} de 100`}>
          <div>
            <p className="tabular text-[52px] leading-none font-semibold tracking-tight">{readiness.score ?? "—"}</p>
            <p className="text-muted-foreground mt-1.5 text-[12px] font-medium tracking-wide uppercase">Preparación</p>
          </div>
        </Ring>
        <div className="w-full min-w-0 flex-1">
          <p className="flex justify-center md:justify-start">
            <span
              className="inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold"
              style={{ color: level.color, background: `color-mix(in oklab, ${level.color} 14%, transparent)` }}
            >
              <LevelIcon className="size-3.5" strokeWidth={2.4} aria-hidden />
              Preparación {level.word.toLowerCase()}
            </span>
          </p>
          <p className="mt-2 text-center text-[22px] font-semibold tracking-tight md:text-left" style={{ color: readiness.level === "unknown" ? undefined : level.color }}>
            {headline}
          </p>
          <p className="text-muted-foreground mt-1.5 text-center text-[15px] leading-relaxed md:text-left">{explanation}</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {readiness.factors.map((factor) => (
              <FactorTile key={factor.key} factor={factor} value={factor.key === "sleep" ? (sleepMin ?? factor.value) : factor.value} />
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

/**
 * A factor as the person reads it elsewhere on the page: the raw value (same
 * source and rounding as its card), then how much it lifts today's readiness
 * as a bar. The 0–100 factor score stays off the tile: next to the cards'
 * values and the night's own sleep score it read as a third, competing number.
 */
function FactorTile({ factor, value }: { factor: ReadinessFactor; value: number | null }) {
  const { icon: Icon, color } = FACTOR_ICON[factor.key];
  const sleep = factor.key === "sleep";
  const unit = factor.key === "hrv" ? "ms" : factor.key === "resting_hr" ? "lpm" : undefined;
  // Sleep's detail repeats the duration; say the target instead.
  const detail = sleep && value !== null && factor.baseline !== null ? `de ${fmtMinutes(factor.baseline)} de objetivo` : factor.detail;
  return (
    <li className="bg-muted/60 rounded-2xl p-3.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
        <Icon className="size-3.5" style={{ color }} strokeWidth={2.2} />
        {factor.label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="tabular text-[20px] leading-none font-semibold tracking-tight">{value === null ? "—" : sleep ? fmtMinutes(value) : fmtNumber(value)}</span>
        {unit && value !== null && <span className="text-muted-foreground text-[12px]">{unit}</span>}
      </p>
      <div
        className="bg-background/70 mt-2.5 h-1.5 overflow-hidden rounded-full"
        role="meter"
        aria-label={`Aporte de ${factor.label.toLowerCase()} a la preparación`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={factor.score ?? undefined}
        title={factor.score === null ? undefined : `Aporte a la preparación: ${factor.score} de 100`}
      >
        <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${factor.score ?? 0}%`, background: color }} />
      </div>
      <p className="text-muted-foreground mt-2 text-[12px] leading-snug">{detail}</p>
    </li>
  );
}
