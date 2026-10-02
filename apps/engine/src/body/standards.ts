/**
 * InBody-style analysis: where weight, muscle, fat and each body segment sit
 * against the standard for the person's height and sex.
 *
 * Sources and assumptions:
 * - Standard weight = BMI 22 (men) or 21.5 (women) × height², standard body fat
 *   15 % (men) or 23 % (women); InBody, "The Professional's Guide to the InBody
 *   Result Sheet" (2018).
 * - Muscle-Fat Analysis normal ranges, in % of the standard: weight 85–115,
 *   skeletal muscle 90–110, fat mass 80–160; the axes are the sheet's printed
 *   ticks (InBody 270/570 result sheets). Obesity: BMI 18.5–25, % fat 10–20
 *   (men) or 18–28 (women); visceral fat level 1–9 is normal, 10+ high.
 * - Standard skeletal muscle is not published by InBody. We take it as the
 *   standard fat-free mass × 0.56 (men) or 0.55 (women), the usual SMM / FFM
 *   ratio on InBody sheets at standard weight.
 * - Segmental standards are not published either. Each segment's standard is a
 *   typical share of the standard lean (or fat) mass, read off InBody sample
 *   sheets; normal is 90–110 % for lean, 80–160 % for fat, like the whole body.
 *   Without a height, segments compare with the person's own weight (InBody's
 *   second segmental bar does the same).
 * - Sex unset or "other": the mean of the male and female constants.
 * These are approximations of InBody's bands, good for colour and direction,
 * not a reproduction of its proprietary tables.
 */
import type { BodyAnalysis, BodyBand, BodyGauge, BodyScan, Profile, Segmental, SegmentKey, SegmentValue } from "@pulso/contract";

type Sex = "male" | "female" | null;

const BY_SEX = {
  male: { bmi: 22, fat: 0.15, smm: 0.56, pbf: [10, 20], pbfTicks: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50] },
  female: { bmi: 21.5, fat: 0.23, smm: 0.55, pbf: [18, 28], pbfTicks: [8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58] },
};

/** Share of the whole-body standard lean / fat mass in each segment. */
const SHARES = {
  male: { lean: { arm: 0.055, trunk: 0.42, leg: 0.15 }, fat: { arm: 0.06, trunk: 0.48, leg: 0.17 } },
  female: { lean: { arm: 0.047, trunk: 0.435, leg: 0.148 }, fat: { arm: 0.085, trunk: 0.43, leg: 0.19 } },
};

const mean = (a: number, b: number) => (a + b) / 2;

export function constants(sex: Sex) {
  if (sex) return { ...BY_SEX[sex], shares: SHARES[sex] };
  const [m, f] = [BY_SEX.male, BY_SEX.female];
  const share = (k: "lean" | "fat", s: "arm" | "trunk" | "leg") => mean(SHARES.male[k][s], SHARES.female[k][s]);
  return {
    bmi: mean(m.bmi, f.bmi),
    fat: mean(m.fat, f.fat),
    smm: mean(m.smm, f.smm),
    pbf: [mean(m.pbf[0]!, f.pbf[0]!), mean(m.pbf[1]!, f.pbf[1]!)],
    pbfTicks: m.pbfTicks.map((t, i) => mean(t, f.pbfTicks[i]!)),
    shares: {
      lean: { arm: share("lean", "arm"), trunk: share("lean", "trunk"), leg: share("lean", "leg") },
      fat: { arm: share("fat", "arm"), trunk: share("fat", "trunk"), leg: share("fat", "leg") },
    },
  };
}

/** Standard weight, fat and skeletal muscle (kg) for a height. */
export function standards(heightCm: number, sex: Sex) {
  const c = constants(sex);
  const weight = c.bmi * (heightCm / 100) ** 2;
  return { weight, fat: weight * c.fat, smm: weight * (1 - c.fat) * c.smm };
}

/** % of the standard on the sheet's axes; ticks are evenly spaced even where their steps are not. */
const AXES = {
  weight: { normal: [85, 115], ticks: [55, 70, 85, 100, 115, 130, 145, 160, 175, 190, 205] },
  skeletalMuscleMass: { normal: [90, 110], ticks: [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170] },
  bodyFatMass: { normal: [80, 160], ticks: [40, 60, 80, 100, 160, 220, 280, 340, 400, 460, 520] },
  bmi: { normal: [18.5, 25], ticks: [10, 15, 18.5, 21, 25, 30, 35, 40, 45, 50, 55] },
  visceralFatLevel: { normal: [1, 9], ticks: [1, 5, 10, 15, 20] },
} as const;

/** 0–1 along a bar whose `ticks` are drawn evenly spaced; clamped to the ends. */
export function axisPosition(ticks: readonly number[], value: number): number {
  const last = ticks.length - 1;
  if (value <= ticks[0]!) return 0;
  if (value >= ticks[last]!) return 1;
  const i = ticks.findIndex((t) => t > value) - 1;
  return (i + (value - ticks[i]!) / (ticks[i + 1]! - ticks[i]!)) / last;
}

export const band = (value: number, low: number, high: number): BodyBand => (value < low ? "low" : value > high ? "high" : "normal");

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const tick = (n: number) => n.toLocaleString("es", { maximumFractionDigits: 1 });

/**
 * One bar. With `standard` the axis is % of it (value and ranges stay in kg);
 * without, the axis is the metric's own scale.
 */
export function gauge(metric: BodyGauge["metric"], unit: BodyGauge["unit"], scan: BodyScan, previous: number | null, axis: { normal: readonly number[]; ticks: readonly number[] }, standard?: number): BodyGauge {
  const value = scan[metric]!;
  const toAxis = (v: number) => (standard ? (v / standard) * 100 : v);
  const fromAxis = (v: number) => (standard ? (v * standard) / 100 : v);
  const [low, high] = axis.normal as [number, number];
  return {
    metric,
    measuredAt: scan.measuredAt,
    value,
    previous,
    unit,
    normal: { low: round(fromAxis(low)), high: round(fromAxis(high)) },
    band: band(toAxis(value), low, high),
    percent: standard ? Math.round(toAxis(value)) : null,
    at: {
      value: axisPosition(axis.ticks, toAxis(value)),
      previous: previous == null ? null : axisPosition(axis.ticks, toAxis(previous)),
      low: axisPosition(axis.ticks, low),
      high: axisPosition(axis.ticks, high),
    },
    ticks: axis.ticks.map(tick),
  };
}

/** Height from the profile, else from a scan's weight and BMI (every InBody sheet prints both). */
export function heightOf(profile: Profile, scans: BodyScan[]): { cm: number; from: "profile" | "scan" } | null {
  if (profile.heightCm) return { cm: profile.heightCm, from: "profile" };
  const scan = scans.find((s) => s.weight && s.bmi);
  return scan ? { cm: round(Math.sqrt(scan.weight! / scan.bmi!) * 100), from: "scan" } : null;
}

const SEGMENT_KIND: Record<SegmentKey, "arm" | "trunk" | "leg"> = { rightArm: "arm", leftArm: "arm", trunk: "trunk", rightLeg: "leg", leftLeg: "leg" };

/** Each segment as % of its standard: `whole` is the standard whole-body lean or fat mass the shares divide. */
export function segmentValues(values: Segmental, whole: number | null, shares: Record<"arm" | "trunk" | "leg", number>, normal: [number, number]): Record<SegmentKey, SegmentValue> {
  const entry = (key: SegmentKey): SegmentValue => {
    const kg = values[key];
    if (!whole) return { kg, percent: null, band: null };
    const percent = Math.round((kg / (whole * shares[SEGMENT_KIND[key]])) * 100);
    return { kg, percent, band: band(percent, normal[0], normal[1]) };
  };
  return { rightArm: entry("rightArm"), leftArm: entry("leftArm"), trunk: entry("trunk"), rightLeg: entry("rightLeg"), leftLeg: entry("leftLeg") };
}

/** Left-right for arms and legs (within 5 % is even), and upper vs lower body when both have a %. */
export function balance(lean: Record<SegmentKey, SegmentValue>): { text: string; even: boolean }[] {
  const pair = (plural: string, right: SegmentValue, left: SegmentValue, singular: string) => {
    const gap = Math.abs(right.kg - left.kg) / Math.max(right.kg, left.kg, 0.001);
    if (gap < 0.05) return { text: `${plural} equilibrad${plural === "Brazos" ? "os" : "as"}`, even: true };
    return { text: `${singular} ${right.kg < left.kg ? "der." : "izq."} ${Math.round(gap * 100)} % menos`, even: false };
  };
  const out = [pair("Brazos", lean.rightArm, lean.leftArm, "Brazo"), pair("Piernas", lean.rightLeg, lean.leftLeg, "Pierna")];
  const avg = (a: SegmentValue, b: SegmentValue) => (a.percent != null && b.percent != null ? (a.percent + b.percent) / 2 : null);
  const upper = avg(lean.rightArm, lean.leftArm);
  const lower = avg(lean.rightLeg, lean.leftLeg);
  if (upper != null && lower != null) {
    const gap = upper - lower;
    out.push(Math.abs(gap) <= 10 ? { text: "Tren superior e inferior a la par", even: true } : { text: gap > 0 ? "Más desarrollo arriba que abajo" : "Más desarrollo abajo que arriba", even: false });
  }
  return out;
}

/** The InBody-style analysis for the newest scans (newest first) and the person's profile. */
export function bodyAnalysis(scans: BodyScan[], profile: Profile): BodyAnalysis {
  const sex: Sex = profile.sex === "male" || profile.sex === "female" ? profile.sex : null;
  const c = constants(sex);
  const height = heightOf(profile, scans);
  const std = height ? standards(height.cm, sex) : null;
  const previous = (key: keyof BodyScan, after: BodyScan) => (scans.slice(scans.indexOf(after) + 1).find((s) => s[key] != null)?.[key] as number | undefined) ?? null;
  const newest = (key: "bmi" | "percentBodyFat" | "visceralFatLevel") => scans.find((s) => s[key] != null);

  const full = scans.find((s) => s.weight != null && s.skeletalMuscleMass != null && s.bodyFatMass != null);
  const muscleFat =
    full && std
      ? {
          measuredAt: full.measuredAt,
          gauges: [
            gauge("weight", "kg", full, previous("weight", full), AXES.weight, std.weight),
            gauge("skeletalMuscleMass", "kg", full, previous("skeletalMuscleMass", full), AXES.skeletalMuscleMass, std.smm),
            gauge("bodyFatMass", "kg", full, previous("bodyFatMass", full), AXES.bodyFatMass, std.fat),
          ],
        }
      : null;

  const obesity: BodyGauge[] = [];
  const bmi = newest("bmi");
  if (bmi) obesity.push(gauge("bmi", "kg/m²", bmi, previous("bmi", bmi), AXES.bmi));
  const pbf = newest("percentBodyFat");
  if (pbf) obesity.push(gauge("percentBodyFat", "%", pbf, previous("percentBodyFat", pbf), { normal: c.pbf, ticks: c.pbfTicks }));
  const visceral = newest("visceralFatLevel");
  if (visceral) obesity.push(gauge("visceralFatLevel", "nivel", visceral, previous("visceralFatLevel", visceral), AXES.visceralFatLevel));

  const seg = scans.find((s) => s.segmentalLean || s.segmentalFat);
  let segments: BodyAnalysis["segments"] = null;
  if (seg) {
    // Standard whole-body lean and fat for the height, else for this scan's own weight.
    const basisWeight = std?.weight ?? seg.weight;
    const lean = seg.segmentalLean && segmentValues(seg.segmentalLean, basisWeight ? basisWeight * (1 - c.fat) : null, c.shares.lean, [90, 110]);
    const fat = seg.segmentalFat && segmentValues(seg.segmentalFat, basisWeight ? basisWeight * c.fat : null, c.shares.fat, [80, 160]);
    segments = { measuredAt: seg.measuredAt, basis: std ? "height" : "weight", lean, fat, balance: lean ? balance(lean) : [] };
  }

  return {
    basis: height && std ? { heightCm: height.cm, heightFrom: height.from, sex, standardWeight: round(std.weight) } : null,
    muscleFat,
    obesity,
    segments,
  };
}
