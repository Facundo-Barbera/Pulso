/**
 * Pure sleep math: grouping HealthKit samples into nights, picking a source,
 * and the derived metrics (score, debt, regularity, insights). No database.
 */
import type { SleepNight, SleepScore, SleepScoreFactor, SleepSegment, SleepSegmentInput, SleepSourceKind, SleepStage, SleepSummary } from "@pulso/contract";

export const DEFAULT_TARGET_MIN = 480;
/** Nights a night is compared against (consistency, insights) and the summary window. */
export const HISTORY_NIGHTS = 14;

const MIN = 60_000;
const DAY = 86_400_000;
const ASLEEP: ReadonlySet<SleepStage> = new Set(["core", "deep", "rem", "asleep"]);

export type StoredSegment = Omit<SleepSegmentInput, "sourceKind"> & { sourceKind: SleepSourceKind; night: string };

/** `source` of a night logged by hand, shown as is. */
export const MANUAL_SOURCE = "Registrada a mano";
/** A night before its score and insights, which depend on the nights around it. */
export type BaseNight = Omit<SleepNight, "score" | "insights">;

/** A night runs 18:00 → 18:00 local and is named after the day you wake up. */
export function nightOf(startMs: number, tzOffsetMin: number): string {
  return new Date(startMs + tzOffsetMin * MIN + 6 * 3_600_000).toISOString().slice(0, 10);
}

const minutes = (ms: number) => Math.round(ms / MIN);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}
const midnight = (night: string) => Date.parse(`${night}T00:00:00Z`);
/** Minutes from local midnight of `night` (negative = the evening before). */
const localMin = (ms: number, night: string, tz: number) => minutes(ms + tz * MIN - midnight(night));

/** "7 h 20 min", "45 min", "8 h". */
export function formatDuration(totalMin: number): string {
  const m = Math.round(Math.abs(totalMin));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Prefer Apple Watch, then a source with stages, then the one that saw the most sleep. */
export function pickSource(bySource: Map<string, StoredSegment[]>): string | undefined {
  const rank = (raw: StoredSegment[]) => {
    const segs = dedupeSegments(raw);
    return [
      segs.some((s) => s.sourceKind === "watch") ? 1 : 0,
      segs.some((s) => s.stage === "core" || s.stage === "deep" || s.stage === "rem") ? 1 : 0,
      segs.filter((s) => ASLEEP.has(s.stage)).reduce((a, s) => a + s.end - s.start, 0),
    ];
  };
  const beats = (a: number[], b: number[]) => {
    const i = a.findIndex((x, k) => x !== b[k]);
    return i >= 0 && a[i]! > b[i]!;
  };
  let best: [string, number[]] | undefined;
  for (const [source, segs] of bySource) {
    const r = rank(segs);
    if (!best || beats(r, best[1])) best = [source, r];
  }
  return best?.[0];
}

/** Staged sleep is more precise than "asleep", so it keeps the time they share. */
const SLEEP_RANK: Partial<Record<SleepStage, number>> = { core: 2, deep: 2, rem: 2, asleep: 1 };

/**
 * One source can still hold the same minute twice (an app writing both
 * "asleep" and stages, or a sample stored twice). Every minute counts once:
 * sleep stages are clipped against each other (staged first), and awake/in-bed
 * only against samples of their own stage.
 */
export function dedupeSegments(segs: StoredSegment[]): StoredSegment[] {
  const taken = new Map<string, [number, number][]>();
  const kept: StoredSegment[] = [];
  const ordered = [...segs].sort((a, b) => (SLEEP_RANK[b.stage] ?? 0) - (SLEEP_RANK[a.stage] ?? 0) || a.start - b.start || a.end - b.end);
  for (const s of ordered) {
    const group = SLEEP_RANK[s.stage] ? "sleep" : s.stage;
    const used = taken.get(group) ?? [];
    let pieces: [number, number][] = [[s.start, s.end]];
    for (const [from, to] of used) pieces = pieces.flatMap(([a, b]) => (to <= a || from >= b ? [[a, b]] : [[a, Math.min(b, from)], [Math.max(a, to), b]]) as [number, number][]).filter(([a, b]) => b > a);
    taken.set(group, [...used, ...pieces]);
    for (const [start, end] of pieces) kept.push({ ...s, start, end });
  }
  return kept;
}

/** One night from the preferred source's samples. Undefined when nothing in it is actual sleep. */
export function buildNight(night: string, all: StoredSegment[]): BaseNight | undefined {
  const bySource = new Map<string, StoredSegment[]>();
  for (const s of all) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  const source = pickSource(bySource);
  const segs = dedupeSegments(bySource.get(source ?? "") ?? []).sort((a, b) => a.start - b.start);
  const asleep = segs.filter((s) => ASLEEP.has(s.stage));
  if (!asleep.length) return undefined;

  const total = (stage: SleepStage) => minutes(segs.filter((s) => s.stage === stage).reduce((a, s) => a + s.end - s.start, 0));
  const [core, deep, rem, unspecified, awake] = (["core", "deep", "rem", "asleep", "awake"] as const).map(total) as [number, number, number, number, number];
  const asleepMin = core + deep + rem + unspecified;
  const inBedStart = Math.min(...segs.map((s) => s.start));
  const inBedEnd = Math.max(...segs.map((s) => s.end));
  const inBed = Math.max(asleepMin, minutes(inBedEnd - inBedStart));
  const asleepStart = Math.min(...asleep.map((s) => s.start));
  const asleepEnd = Math.max(...asleep.map((s) => s.end));
  const staged = core + deep + rem;
  const tz = segs[0]!.tzOffsetMin;

  return {
    night,
    source: source!,
    sourceKind: segs[0]!.sourceKind,
    tzOffsetMin: tz,
    inBedStart,
    inBedEnd,
    asleepStart,
    asleepEnd,
    minutes: { inBed, asleep: asleepMin, awake, core, deep, rem, unspecified },
    efficiency: inBed ? asleepMin / inBed : 0,
    stagePct: staged ? { core: core / staged, deep: deep / staged, rem: rem / staged } : null,
    bedtimeMin: localMin(inBedStart, night, tz),
    wakeMin: localMin(asleepEnd, night, tz),
    segments: segs.map(({ start, end, stage }): SleepSegment => ({ start, end, stage })),
  };
}

/** Groups samples by night and builds each one, oldest first. */
export function buildNights(segments: StoredSegment[]): BaseNight[] {
  const byNight = new Map<string, StoredSegment[]>();
  for (const s of segments) byNight.set(s.night, [...(byNight.get(s.night) ?? []), s]);
  return [...byNight.keys()]
    .sort()
    .map((night) => buildNight(night, byNight.get(night)!))
    .filter((n): n is BaseNight => !!n);
}

/** The nights in the `HISTORY_NIGHTS` calendar days before `night`. */
function historyOf(night: BaseNight, all: BaseNight[]): BaseNight[] {
  const end = midnight(night.night);
  return all.filter((n) => midnight(n.night) < end && midnight(n.night) >= end - HISTORY_NIGHTS * DAY);
}

/** 0–100 from duration (40), efficiency (20), deep+REM (20) and bedtime consistency (20). Missing factors are left out and the rest rescaled. */
export function scoreNight(night: BaseNight, history: BaseNight[], targetMin: number): SleepScore {
  const m = night.minutes;
  const factors: (SleepScoreFactor & { ratio: number; issue: string })[] = [];
  const add = (key: SleepScoreFactor["key"], label: string, maxPoints: number, ratio: number, detail: string, issue: string) =>
    factors.push({ key, label, maxPoints, points: Math.round(maxPoints * ratio), detail, ratio, issue });

  const durationRatio = clamp01((m.asleep / targetMin - 0.5) / 0.5);
  add(
    "duration",
    "Duración",
    40,
    durationRatio,
    `${formatDuration(m.asleep)} de ${formatDuration(targetMin)}`,
    `Dormiste ${formatDuration(m.asleep)}, ${formatDuration(targetMin - m.asleep)} menos que tu objetivo.`,
  );
  // A night logged by hand has no time awake in bed to measure.
  const manual = night.sourceKind === "manual";
  if (!manual) {
    add(
      "efficiency",
      "Eficiencia",
      20,
      clamp01((night.efficiency - 0.75) / 0.2),
      `${Math.round(night.efficiency * 100)} % del tiempo en cama dormido`,
      `Pasaste ${formatDuration(m.inBed - m.asleep)} despierto en la cama.`,
    );
  }
  if (night.stagePct) {
    const restorative = night.stagePct.deep + night.stagePct.rem;
    add(
      "restoration",
      "Profundo + REM",
      20,
      clamp01((restorative - 0.2) / 0.2),
      `${Math.round(restorative * 100)} % del sueño`,
      `Poco sueño profundo y REM: ${Math.round(restorative * 100)} % del total.`,
    );
  }
  const usual = history.length >= 3 ? mean(history.map((n) => n.bedtimeMin))! : null;
  if (usual !== null) {
    const diff = Math.round(night.bedtimeMin - usual);
    add(
      "consistency",
      "Regularidad",
      20,
      clamp01(1 - Math.abs(diff) / 90),
      Math.abs(diff) < 5 ? "A tu hora de siempre" : `${Math.abs(diff)} min ${diff > 0 ? "más tarde" : "antes"} que de costumbre`,
      `Te acostaste ${formatDuration(diff)} ${diff > 0 ? "más tarde" : "antes"} que de costumbre.`,
    );
  }

  const max = factors.reduce((a, f) => a + f.maxPoints, 0);
  const value = Math.round((100 * factors.reduce((a, f) => a + f.maxPoints * f.ratio, 0)) / max);
  const weakest = [...factors].sort((a, b) => a.ratio - b.ratio)[0]!;
  const explanation =
    value >= 85 || weakest.ratio >= 0.9
      ? manual
        ? `Buena noche: ${formatDuration(m.asleep)}.`
        : `Buena noche: ${formatDuration(m.asleep)} con ${Math.round(night.efficiency * 100)} % de eficiencia.`
      : weakest.issue;
  return { value, factors: factors.map(({ ratio: _r, issue: _i, ...f }) => f), explanation };
}

/** Spanish comparisons of one night against its history. */
export function nightInsights(night: BaseNight, history: BaseNight[], targetMin: number): string[] {
  const out: string[] = [];
  if (history.length >= 3) {
    const bed = Math.round(night.bedtimeMin - mean(history.map((n) => n.bedtimeMin))!);
    if (Math.abs(bed) >= 20) out.push(`Te acostaste ${formatDuration(bed)} ${bed > 0 ? "más tarde" : "más temprano"} que tu promedio.`);
    const slept = Math.round(night.minutes.asleep - mean(history.map((n) => n.minutes.asleep))!);
    if (Math.abs(slept) >= 20) out.push(`Dormiste ${formatDuration(slept)} ${slept > 0 ? "más" : "menos"} que tu promedio.`);
    const staged = history.filter((n) => n.stagePct);
    if (night.stagePct && staged.length >= 3) {
      const deep = Math.round((night.stagePct.deep - mean(staged.map((n) => n.stagePct!.deep))!) * 100);
      if (Math.abs(deep) >= 4) out.push(`Sueño profundo ${Math.abs(deep)} puntos ${deep > 0 ? "por encima" : "por debajo"} de lo habitual.`);
    }
  }
  if (night.minutes.asleep >= targetMin) out.push(`Llegaste a tu objetivo de ${formatDuration(targetMin)}.`);
  return out;
}

/** Score and insights for every night, each against the nights before it. Newest first. */
export function describeNights(base: BaseNight[], targetMin: number): SleepNight[] {
  const sorted = [...base].sort((a, b) => a.night.localeCompare(b.night));
  return sorted
    .map((night) => {
      const history = historyOf(night, sorted);
      return { ...night, score: scoreNight(night, history, targetMin), insights: nightInsights(night, history, targetMin) };
    })
    .reverse();
}

/**
 * Sleep Regularity Index-like score: for each pair of consecutive nights, the
 * share of minutes (18:00 → 18:00 local) in the same sleep/wake state 24 h
 * apart, mapped to 0–100. Null without a consecutive pair.
 */
export function regularity(nights: BaseNight[]): number | null {
  const sorted = [...nights].sort((a, b) => a.night.localeCompare(b.night));
  const asleepMask = (n: BaseNight) => {
    const mask = new Uint8Array(1440);
    for (const s of n.segments) {
      if (!ASLEEP.has(s.stage)) continue;
      const from = Math.max(0, localMin(s.start, n.night, n.tzOffsetMin) + 360);
      const to = Math.min(1440, localMin(s.end, n.night, n.tzOffsetMin) + 360);
      mask.fill(1, from, Math.max(from, to));
    }
    return mask;
  };
  const scores: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (midnight(b.night) - midnight(a.night) !== DAY) continue;
    const [ma, mb] = [asleepMask(a), asleepMask(b)];
    let same = 0;
    for (let m = 0; m < 1440; m++) if (ma[m] === mb[m]) same++;
    scores.push(200 * (same / 1440) - 100);
  }
  const avg = mean(scores);
  return avg === null ? null : Math.round(Math.max(0, avg));
}

/** Averages, debt and regularity over the `days` calendar days ending at the newest night. */
export function summarize(all: SleepNight[], targetMin: number, days = HISTORY_NIGHTS): SleepSummary {
  const newest = all.reduce<string | null>((a, n) => (a === null || n.night > a ? n.night : a), null);
  const nights = newest === null ? [] : all.filter((n) => midnight(n.night) > midnight(newest) - days * DAY).sort((a, b) => a.night.localeCompare(b.night));
  const round = (x: number | null) => (x === null ? null : Math.round(x));
  const debtMin = Math.max(0, nights.reduce((a, n) => a + targetMin - n.minutes.asleep, 0));
  const bedSd = sd(nights.map((n) => n.bedtimeMin));
  const reg = regularity(nights);
  const efficiency = mean(nights.filter((n) => n.sourceKind !== "manual").map((n) => n.efficiency));

  const insights: string[] = [];
  if (nights.length) {
    insights.push(
      debtMin >= 30
        ? `Llevas ${formatDuration(debtMin)} de deuda de sueño en las últimas ${nights.length} noches.`
        : `Sin deuda de sueño en las últimas ${nights.length} noches.`,
    );
  }
  if (bedSd !== null && bedSd >= 45) insights.push(`Tu hora de acostarte varía ±${Math.round(bedSd)} min de una noche a otra.`);
  if (reg !== null) insights.push(reg >= 80 ? "Tus horarios de sueño son muy regulares." : reg < 60 ? "Tus horarios de sueño son irregulares: acostarte y despertar a la misma hora ayuda." : "Tus horarios de sueño son bastante regulares.");

  return {
    nights: nights.length,
    from: nights[0]?.night ?? null,
    to: nights.at(-1)?.night ?? null,
    targetMin,
    avgAsleepMin: round(mean(nights.map((n) => n.minutes.asleep))),
    avgScore: round(mean(nights.map((n) => n.score.value))),
    avgEfficiency: efficiency === null ? null : Math.round(efficiency * 100) / 100,
    avgBedtimeMin: round(mean(nights.map((n) => n.bedtimeMin))),
    avgWakeMin: round(mean(nights.map((n) => n.wakeMin))),
    bedtimeSdMin: round(bedSd),
    wakeSdMin: round(sd(nights.map((n) => n.wakeMin))),
    regularity: reg,
    debtMin,
    insights,
  };
}
