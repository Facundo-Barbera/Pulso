import type { DailyMetrics, DateString, Readiness, ReadinessFactor } from "@pulso/contract";
import { addDays } from "./dates";

/** How far back the personal baseline looks, and how many days it needs before it is trusted. */
export const BASELINE_DAYS = 28;
export const MIN_BASELINE = 5;
/** Sleep target in minutes. */
export const SLEEP_TARGET = 480;

const WEIGHTS = { hrv: 0.4, resting_hr: 0.3, sleep: 0.3 } as const;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

/** At your baseline you score 70; each standard deviation in the good direction is worth 20 points. */
const fromZ = (z: number) => clamp(70 + 20 * z);

function hrvFactor(value: number | null, history: number[]): ReadinessFactor {
  const base = { key: "hrv", label: "VFC", value } as const;
  if (history.length < MIN_BASELINE) return { ...base, baseline: null, score: null, detail: `Armando tu media (${history.length}/${MIN_BASELINE} días)` };
  const baseline = mean(history);
  if (value === null) return { ...base, baseline, score: null, detail: "Sin medición de anoche" };
  // HRV is roughly log-normal, so compare on the log scale.
  const logs = history.map(Math.log);
  const z = (Math.log(value) - mean(logs)) / Math.max(sd(logs), 0.05);
  const pct = Math.round((value / baseline - 1) * 100);
  const detail = Math.abs(pct) < 3 ? "En tu media" : `${Math.abs(pct)}% ${pct > 0 ? "por encima" : "por debajo"} de tu media`;
  return { ...base, baseline, score: fromZ(z), detail };
}

function restingFactor(value: number | null, history: number[]): ReadinessFactor {
  const base = { key: "resting_hr", label: "Pulso en reposo", value } as const;
  if (history.length < MIN_BASELINE) return { ...base, baseline: null, score: null, detail: `Armando tu media (${history.length}/${MIN_BASELINE} días)` };
  const baseline = mean(history);
  if (value === null) return { ...base, baseline, score: null, detail: "Sin medición de hoy" };
  // Lower than usual is good.
  const z = (baseline - value) / Math.max(sd(history), 1);
  const diff = Math.round(value - baseline);
  const detail = diff === 0 ? "En tu media" : `${Math.abs(diff)} lpm ${diff > 0 ? "por encima" : "por debajo"} de tu media`;
  return { ...base, baseline, score: fromZ(z), detail };
}

const hoursMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};

function sleepFactor(minutes: number | null): ReadinessFactor {
  const base = { key: "sleep", label: "Sueño", value: minutes, baseline: SLEEP_TARGET } as const;
  if (minutes === null) return { ...base, score: null, detail: "Sin datos de sueño anoche" };
  // Full marks at the target, 20 points off per hour short.
  const score = clamp(100 - (Math.max(0, SLEEP_TARGET - minutes) / 60) * 20);
  return { ...base, score, detail: `${hoursMinutes(minutes)} de ${hoursMinutes(SLEEP_TARGET)}` };
}

const REASONS: Record<ReadinessFactor["key"], { good: string; bad: string }> = {
  hrv: { good: "tu VFC está por encima de lo habitual", bad: "tu VFC está por debajo de lo habitual" },
  resting_hr: { good: "tu pulso en reposo está bajo", bad: "tu pulso en reposo está más alto que de costumbre" },
  sleep: { good: "dormiste bien", bad: "dormiste poco" },
};

function explain(level: Readiness["level"], scored: ReadinessFactor[]): string {
  if (level === "unknown") return "Todavía no hay datos de Salud para calcular tu recuperación.";
  const sorted = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const weakest = sorted[0]!;
  const strongest = sorted[sorted.length - 1]!;
  if (level === "high") return `Buena recuperación: ${REASONS[strongest.key].good}. Buen día para exigirse.`;
  if (level === "low") return `Recuperación baja: ${REASONS[weakest.key].bad}. Mejor algo suave hoy.`;
  if ((weakest.score ?? 100) < 60) return `Recuperación normal, aunque ${REASONS[weakest.key].bad}. Entrenamiento moderado.`;
  return "Recuperación normal: todo en tu rango habitual.";
}

/**
 * Readiness for `date` from that day's metrics and the days before it.
 * `history` may contain any days; only the 28 before `date` count. Pure.
 */
export function computeReadiness(date: DateString, today: DailyMetrics | undefined, history: DailyMetrics[]): Readiness {
  const window = history.filter((d) => d.date < date && d.date >= addDays(date, -BASELINE_DAYS));
  const values = (pick: (d: DailyMetrics) => number | null) =>
    window.map(pick).filter((v): v is number => v !== null && v > 0);
  const hrvHistory = values((d) => d.hrv);
  const restingHistory = values((d) => d.restingHeartRate);

  const factors = [
    hrvFactor(today?.hrv ?? null, hrvHistory),
    restingFactor(today?.restingHeartRate ?? null, restingHistory),
    sleepFactor(today?.sleepMinutes ?? null),
  ];
  const scored = factors.filter((f) => f.score !== null);
  const weight = scored.reduce((a, f) => a + WEIGHTS[f.key], 0);
  const score = scored.length ? clamp(scored.reduce((a, f) => a + f.score! * WEIGHTS[f.key], 0) / weight) : null;
  const level = score === null ? "unknown" : score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  const baselineDays = window.filter((d) => d.hrv !== null || d.restingHeartRate !== null).length;
  return { date, score, level, factors, explanation: explain(level, scored), baselineDays };
}

