/**
 * Trend and projection for one body metric.
 *
 * Readings are collapsed to one median per day (a scale may log several),
 * limited to the last 120 days so an old phase does not steer today's
 * trend, then fitted with Theil–Sen: the slope is the median of all pairwise
 * slopes, so one bad weigh-in or a dehydrated scan barely moves it. The band
 * is an 80% prediction interval (where a reading on that day would land),
 * from the robust residual spread and the slope's uncertainty, so it widens
 * with the horizon.
 */
import type { BodyGoal, BodyMetric, BodyProjection, ProjectionPoint } from "@pulso/contract";
import { round } from "./fields";

const DAY = 86_400_000;
const WINDOW_DAYS = 120;
const Z80 = 1.2816;
export const HORIZON_WEEKS = [4, 8, 12];

export const UNIT: Record<BodyMetric, "kg" | "%"> = { weight: "kg", bodyFatMass: "kg", skeletalMuscleMass: "kg", percentBodyFat: "%" };
const LABEL: Record<BodyMetric, (v: string) => string> = {
  weight: (v) => `${v} kg`,
  bodyFatMass: (v) => `${v} kg de grasa`,
  skeletalMuscleMass: (v) => `${v} kg de músculo`,
  percentBodyFat: (v) => `${v}% de grasa`,
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** One point per calendar day (UTC): median value at the day's mean time. Oldest first. */
export function dailyMedians(points: { at: number; value: number }[]): { at: number; value: number }[] {
  const days = new Map<number, { at: number; value: number }[]>();
  for (const p of points) {
    const day = Math.floor(p.at / DAY);
    days.set(day, [...(days.get(day) ?? []), p]);
  }
  return [...days.values()]
    .map((ps) => ({ at: Math.round(ps.reduce((s, p) => s + p.at, 0) / ps.length), value: median(ps.map((p) => p.value)) }))
    .sort((a, b) => a.at - b.at);
}

export type Trend = {
  /** Trend value at `lastAt`. */
  level: number;
  /** Units per day. */
  slope: number;
  lastAt: number;
  /** Predicted value and 80% band `days` after the last observation (negative = before). */
  at: (days: number) => { value: number; low: number; high: number };
};

/** Theil–Sen fit. Needs ≥3 days spanning ≥7 days; otherwise null. */
export function fitTrend(points: { at: number; value: number }[]): Trend | null {
  if (points.length < 3) return null;
  const lastAt = points[points.length - 1]!.at;
  const xs = points.map((p) => (p.at - lastAt) / DAY);
  const ys = points.map((p) => p.value);
  if (xs[xs.length - 1]! - xs[0]! < 7) return null;

  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) if (xs[j]! !== xs[i]!) slopes.push((ys[j]! - ys[i]!) / (xs[j]! - xs[i]!));
  }
  const slope = median(slopes);
  const level = median(ys.map((y, i) => y - slope * xs[i]!));

  // Robust residual spread (MAD → σ), and the slope's standard error as OLS would give it with that σ.
  const residuals = ys.map((y, i) => y - (level + slope * xs[i]!));
  const sigma = 1.4826 * median(residuals.map((r) => Math.abs(r - median(residuals))));
  const xMean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sxx = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const n = xs.length;

  return {
    level,
    slope,
    lastAt,
    at: (days) => {
      const value = level + slope * days;
      const spread = Z80 * sigma * Math.sqrt(1 + 1 / n + (days - xMean) ** 2 / sxx);
      return { value, low: value - spread, high: value + spread };
    },
  };
}

const formatNumber = (v: number) => new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(v);

export function formatDay(at: number, now: number): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at).replace(".", "");
}

/** When the trend reaches `target`, and a Spanish sentence for the person. Gives up past two years. */
export function goalEta(metric: BodyMetric, trend: Trend, target: number, now = Date.now()): { eta: number | null; message: string } {
  const label = LABEL[metric](formatNumber(target));
  const gap = target - trend.level;
  if (Math.abs(gap) <= 0.3) return { eta: null, message: `Ya estás en tu objetivo de ${label}.` };
  if (Math.abs(trend.slope) < 1e-6 || Math.sign(gap) !== Math.sign(trend.slope)) {
    return { eta: null, message: `A este ritmo no te acercas a ${label}.` };
  }
  const days = gap / trend.slope;
  if (days > 730) return { eta: null, message: `A este ritmo faltan más de dos años para ${label}.` };
  const eta = trend.lastAt + days * DAY;
  return { eta, message: `A este ritmo llegas a ${label} alrededor del ${formatDay(eta, now)}.` };
}

const point = (trend: Trend, days: number): ProjectionPoint => {
  const p = trend.at(days);
  return { at: Math.round(trend.lastAt + days * DAY), value: round(p.value), low: round(p.low), high: round(p.high) };
};

export function project(metric: BodyMetric, readings: { at: number; value: number }[], goal?: BodyGoal, now = Date.now()): BodyProjection {
  const daily = dailyMedians(readings);
  const lastAt = daily[daily.length - 1]?.at ?? 0;
  const observed = daily.filter((p) => p.at >= lastAt - WINDOW_DAYS * DAY);
  const trend = fitTrend(observed);
  const base = { metric, unit: UNIT[metric], observed: observed.map((p) => ({ at: p.at, value: round(p.value) })) };
  if (!trend) {
    return {
      ...base, current: null, slopePerWeek: null, band: [], horizons: [], goal: null,
      note: "Hacen falta al menos 3 mediciones en días distintos, separadas por una semana o más, para proyectar.",
    };
  }
  const firstDays = (observed[0]!.at - trend.lastAt) / DAY;
  const band: ProjectionPoint[] = [];
  for (let d = firstDays; d < 84; d += 7) band.push(point(trend, d));
  band.push(point(trend, 84));
  const perWeek = trend.slope * 7;
  const unit = UNIT[metric] === "%" ? " puntos" : " kg";
  const note = Math.abs(perWeek) < 0.05 ? "Estable." : `${perWeek < 0 ? "Bajando" : "Subiendo"} ${formatNumber(Math.abs(perWeek))}${unit} por semana.`;
  return {
    ...base,
    current: round(trend.level),
    slopePerWeek: round(perWeek, 3),
    band,
    horizons: HORIZON_WEEKS.map((weeks) => ({ weeks, ...point(trend, weeks * 7) })),
    goal: goal ? { target: goal.target, ...goalEta(metric, trend, goal.target, now) } : null,
    note,
  };
}
