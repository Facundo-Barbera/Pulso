import { describe, expect, test } from "bun:test";
import type { BodyScan } from "@pulso/contract";
import { axisPosition, balance, band, bodyAnalysis, heightOf, segmentValues, standards } from "./standards";

const DAY = 86_400_000;

/** Invented values. */
const scan = (measuredAt: number, values: Partial<BodyScan>): BodyScan =>
  ({ id: String(measuredAt), measuredAt, source: "inbody", weight: null, skeletalMuscleMass: null, bodyFatMass: null, percentBodyFat: null, bmi: null, visceralFatLevel: null, segmentalLean: null, segmentalFat: null, ...values }) as BodyScan;

describe("standards", () => {
  test("standard weight is BMI 22 (men) / 21.5 (women) × height²; fat 15 % / 23 %", () => {
    const man = standards(180, "male");
    expect(man.weight).toBeCloseTo(71.28, 2);
    expect(man.fat).toBeCloseTo(10.69, 2);
    expect(man.smm).toBeCloseTo(71.28 * 0.85 * 0.56, 2);
    const woman = standards(165, "female");
    expect(woman.weight).toBeCloseTo(58.53, 2);
    expect(woman.fat).toBeCloseTo(13.46, 2);
  });

  test("without a sex, the constants sit between the two", () => {
    const { weight } = standards(170, null);
    expect(weight).toBeGreaterThan(standards(170, "female").weight);
    expect(weight).toBeLessThan(standards(170, "male").weight);
  });
});

describe("axisPosition", () => {
  const fat = [40, 60, 80, 100, 160, 220, 280, 340, 400, 460, 520];
  test("ticks are evenly spaced, steps are not", () => {
    expect(axisPosition(fat, 100)).toBeCloseTo(0.3);
    expect(axisPosition(fat, 130)).toBeCloseTo(0.35);
    expect(axisPosition(fat, 70)).toBeCloseTo(0.15);
  });
  test("clamps past either end", () => {
    expect(axisPosition(fat, 10)).toBe(0);
    expect(axisPosition(fat, 900)).toBe(1);
  });
});

test("band is inclusive of the normal range's ends", () => {
  expect(band(90, 90, 110)).toBe("normal");
  expect(band(110, 90, 110)).toBe("normal");
  expect(band(89.9, 90, 110)).toBe("low");
  expect(band(111, 90, 110)).toBe("high");
});

test("height comes from the profile, else from a scan's weight ÷ BMI", () => {
  const scans = [scan(DAY, { weight: 81, bmi: 25 })];
  expect(heightOf({ heightCm: 175 }, scans)).toEqual({ cm: 175, from: "profile" });
  expect(heightOf({}, scans)).toEqual({ cm: 180, from: "scan" });
  expect(heightOf({}, [scan(DAY, { weight: 81 })])).toBeNull();
});

describe("bodyAnalysis", () => {
  const latest = scan(2 * DAY, {
    weight: 84,
    skeletalMuscleMass: 36,
    bodyFatMass: 18,
    percentBodyFat: 21.4,
    bmi: 25.9,
    visceralFatLevel: 8,
    segmentalLean: { rightArm: 3.9, leftArm: 3.8, trunk: 29, rightLeg: 10, leftLeg: 9.6 },
    segmentalFat: { rightArm: 1, leftArm: 1.05, trunk: 9.5, rightLeg: 2.6, leftLeg: 2.6 },
  });
  const before = scan(DAY, { weight: 85, skeletalMuscleMass: 35.5, bodyFatMass: 19.4, percentBodyFat: 22.8, bmi: 26.2 });

  test("muscle-fat bars: kg against the standard for the height, with the scan before as a ghost", () => {
    const a = bodyAnalysis([latest, before], { heightCm: 180, sex: "male" });
    expect(a.basis).toEqual({ heightCm: 180, heightFrom: "profile", sex: "male", standardWeight: 71.3 });
    const [weight, muscle, fat] = a.muscleFat!.gauges;
    // 84 / 71.28 = 118 % of standard: just over the 85–115 normal.
    expect(weight).toMatchObject({ metric: "weight", value: 84, previous: 85, percent: 118, band: "high", normal: { low: 60.6, high: 82 } });
    // 36 / 33.93 = 106 %
    expect(muscle).toMatchObject({ percent: 106, band: "normal", previous: 35.5 });
    // 18 / 10.69 = 168 %, over 160
    expect(fat).toMatchObject({ percent: 168, band: "high" });
    expect(weight!.at.low).toBeCloseTo(0.2);
    expect(weight!.at.high).toBeCloseTo(0.4);
    expect(weight!.at.previous!).toBeGreaterThan(weight!.at.value);
    expect(weight!.ticks[0]).toBe("55");
  });

  test("obesity bars: BMI, % fat by sex and the visceral level", () => {
    const [bmi, pbf, visceral] = bodyAnalysis([latest, before], { heightCm: 180, sex: "male" }).obesity;
    expect(bmi).toMatchObject({ metric: "bmi", band: "high", normal: { low: 18.5, high: 25 }, percent: null });
    expect(pbf).toMatchObject({ band: "high", normal: { low: 10, high: 20 } });
    expect(visceral).toMatchObject({ value: 8, band: "normal", previous: null });
    // The same 21,4 % is normal for a woman.
    expect(bodyAnalysis([latest], { heightCm: 180, sex: "female" }).obesity[1]!.band).toBe("normal");
  });

  test("a weight-only entry does not hide the last full scan", () => {
    const a = bodyAnalysis([scan(3 * DAY, { weight: 83.5 }), latest, before], { sex: "male" });
    expect(a.muscleFat!.measuredAt).toBe(2 * DAY);
    expect(a.basis!.heightFrom).toBe("scan");
  });

  test("segments against the height's standard, with balance callouts", () => {
    const { segments } = bodyAnalysis([latest], { heightCm: 180, sex: "male" });
    expect(segments!.basis).toBe("height");
    // Standard arm lean: 71.28 × 0.85 × 0.055 = 3.33 kg → 3.9 is 117 %.
    expect(segments!.lean!.rightArm).toEqual({ kg: 3.9, percent: 117, band: "high" });
    expect(segments!.fat!.trunk.band).toBe("high");
    expect(segments!.balance.map((b) => b.text)).toEqual(["Brazos equilibrados", "Piernas equilibradas", "Tren superior e inferior a la par"]);
  });

  test("without a height, segments compare with the scan's own weight", () => {
    const noBmi = { ...latest, bmi: null };
    const { segments, muscleFat, basis } = bodyAnalysis([noBmi], {});
    expect(basis).toBeNull();
    expect(muscleFat).toBeNull();
    expect(segments!.basis).toBe("weight");
    expect(segments!.lean!.trunk.percent).not.toBeNull();
  });

  test("nothing to analyse without scans", () => {
    expect(bodyAnalysis([], {})).toEqual({ basis: null, muscleFat: null, obesity: [], segments: null });
  });
});

describe("balance", () => {
  const lean = segmentValues({ rightArm: 4, leftArm: 3.6, trunk: 28, rightLeg: 9.5, leftLeg: 10 }, 60, { arm: 0.055, trunk: 0.42, leg: 0.15 }, [90, 110]);
  test("names the lighter side and by how much", () => {
    expect(balance(lean).slice(0, 2)).toEqual([
      { text: "Brazo izq. 10 % menos", even: false },
      { text: "Pierna der. 5 % menos", even: false },
    ]);
  });
  test("upper vs lower compares their % of standard", () => {
    // Arms ~115 %, legs ~108 %: within 10 points.
    expect(balance(lean)[2]).toEqual({ text: "Tren superior e inferior a la par", even: true });
    const strongArms = segmentValues({ rightArm: 5, leftArm: 5, trunk: 28, rightLeg: 8, leftLeg: 8 }, 60, { arm: 0.055, trunk: 0.42, leg: 0.15 }, [90, 110]);
    expect(balance(strongArms)[2]).toEqual({ text: "Más desarrollo arriba que abajo", even: false });
  });
  test("no % (no basis) means no upper-lower callout", () => {
    expect(balance(segmentValues({ rightArm: 4, leftArm: 4, trunk: 28, rightLeg: 9, leftLeg: 9 }, null, { arm: 1, trunk: 1, leg: 1 }, [90, 110]))).toHaveLength(2);
  });
});
