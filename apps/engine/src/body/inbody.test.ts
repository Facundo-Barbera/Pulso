import { describe, expect, test } from "bun:test";
import { inbodyId, parseDate } from "./fields";
import { decodeDigits, parseInBody } from "./inbody";
import { readInBodyQr } from "./store";

/**
 * A synthetic InBody 270 QR: real structure (39 `!` segments, fixed-width
 * digits at the mapped offsets), invented values. Everything else is zeros.
 */
function synthetic270(values: Record<string, [number, number, string]>, encodeBang = false): string {
  const parts: string[] = Array(39).fill("");
  parts[0] = "270-0000TEST0000";
  const segments: Record<number, string[]> = { 33: [..."0".repeat(119), ..."-0000-0000"], 34: [..."0".repeat(175)], 38: [..."0".repeat(146)] };
  for (const [part, offset, digits] of Object.values(values)) segments[part]!.splice(offset, digits.length, ...digits);
  for (const [part, chars] of Object.entries(segments)) parts[Number(part)] = chars.join("");
  const ibdata = parts.join("!");
  return `https://qrcode.inbody.com?IBData=${encodeBang ? ibdata.replaceAll("!", "%21") : ibdata}`;
}

const SAMPLE = synthetic270({
  height: [33, 0, "1780"],
  date: [33, 9, "20250102083015"],
  protein: [33, 23, "0124"],
  mineral: [33, 35, "0421"],
  bfm: [33, 47, "0149"],
  tbw: [33, 59, "0460"],
  weight: [33, 75, "0784"],
  smm: [33, 91, "0362"],
  bmi: [33, 104, "0247"],
  pbf: [33, 108, "0190"],
  bmr: [34, 4, "1771"],
  whr: [34, 8, "0088"],
  leanRA: [38, 20, "0371"], leanLA: [38, 24, "0369"], leanTR: [38, 28, "0284"], leanRL: [38, 32, "0985"], leanLL: [38, 36, "0980"],
  fatRA: [38, 40, "0012"], fatLA: [38, 44, "0013"], fatTR: [38, 48, "0071"], fatRL: [38, 52, "0024"], fatLL: [38, 56, "0024"],
  smi: [38, 105, "0089"],
});

describe("InBody 270 IBData", () => {
  test("reads every mapped field at its scale", () => {
    const result = parseInBody(SAMPLE);
    if (!result.ok) throw new Error(result.message);
    const s = result.scan;
    expect(s).toMatchObject({
      source: "inbody", device: "270",
      weight: 78.4, skeletalMuscleMass: 36.2, bodyFatMass: 14.9, percentBodyFat: 19, bmi: 24.7, bmr: 1771,
      totalBodyWater: 46, protein: 12.4, mineral: 4.21, waistHipRatio: 0.88, smi: 8.9,
      visceralFatLevel: null, inbodyScore: null, ecwRatio: null,
      segmentalLean: { rightArm: 3.71, leftArm: 3.69, trunk: 28.4, rightLeg: 9.85, leftLeg: 9.8 },
      segmentalFat: { rightArm: 1.2, leftArm: 1.3, trunk: 7.1, rightLeg: 2.4, leftLeg: 2.4 },
      raw: SAMPLE,
    });
    expect(s.measuredAt).toBe(new Date(2025, 0, 2, 8, 30, 15).getTime());
    expect(s.externalId).toBe(inbodyId(s.measuredAt));
  });

  test("a percent-encoded ! does not shift the offsets", () => {
    const result = parseInBody(synthetic270({ weight: [33, 75, "0655"], pbf: [33, 108, "0221"] }, true));
    expect(result.ok && [result.scan.weight, result.scan.percentBodyFat]).toEqual([65.5, 22.1]);
  });

  test("an unmapped model is recognised as InBody but not guessed at", () => {
    const result = parseInBody(SAMPLE.replace("IBData=270-", "IBData=970-"));
    expect(result).toMatchObject({ ok: false, code: "unmapped_ibdata" });
    expect(!result.ok && result.message).toContain("970");
  });

  test("a 270 payload with blanks where the core values go is refused", () => {
    expect(parseInBody(synthetic270({}))).toMatchObject({ ok: false, code: "unmapped_ibdata" });
  });
});

describe("named-value payloads", () => {
  test("query-string codes", () => {
    const result = parseInBody("https://example.com/r?WT=72.4&SMM=33.1&PBF=18,5&VFL=6&date=20250310091500");
    expect(result.ok && result.scan).toMatchObject({ weight: 72.4, skeletalMuscleMass: 33.1, percentBodyFat: 18.5, visceralFatLevel: 6 });
    expect(result.ok && result.scan.measuredAt).toBe(new Date(2025, 2, 10, 9, 15).getTime());
  });

  test("JSON with English export names", () => {
    const result = parseInBody(JSON.stringify({ "Weight(kg)": 80, "Body Fat Mass(kg)": 20, "InBody Score": 74 }), { now: 5_000 });
    expect(result.ok && result.scan).toMatchObject({ weight: 80, bodyFatMass: 20, inbodyScore: 74, measuredAt: 5_000 });
  });

  test("anything else is unknown", () => {
    expect(parseInBody("https://example.com/?utm=1")).toMatchObject({ ok: false, code: "unknown_inbody_format" });
    expect(parseInBody("hola")).toMatchObject({ ok: false, code: "unknown_inbody_format" });
    expect(parseInBody("{not json")).toMatchObject({ ok: false, code: "unknown_inbody_format" });
    expect(parseInBody("   ")).toMatchObject({ ok: false, code: "unknown_inbody_format" });
  });
});

test("unreadable payloads are kept once, under a stable id", () => {
  const first = readInBodyQr("https://example.com/not-inbody");
  const again = readInBodyQr("https://example.com/not-inbody");
  expect(first.ok).toBe(false);
  expect(!first.ok && !again.ok && first.payloadId === again.payloadId).toBe(true);
});

test("decodeDigits and parseDate", () => {
  expect(decodeDigits("0823", 0.1)).toBe(82.3);
  expect(decodeDigits("0317", 0.01)).toBe(3.17);
  expect(decodeDigits("08 3", 0.1)).toBeNull();
  expect(parseDate("20250611174203")).toBe(new Date(2025, 5, 11, 17, 42, 3).getTime());
  expect(parseDate("11/06/2025 17:42")).toBe(new Date(2025, 5, 11, 17, 42).getTime());
  expect(parseDate("2025-06-11")).toBe(new Date(2025, 5, 11).getTime());
  expect(parseDate("20261320")).toBeNull();
  expect(parseDate("-")).toBeNull();
});
