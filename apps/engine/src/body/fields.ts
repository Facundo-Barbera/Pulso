import type { BodyScanInput, BodyScanValues, Segmental } from "@pulso/contract";

/** Every numeric scan value with its plausibility ceiling (catches lb/g mix-ups). Drives SQL, validation and parsers. */
export const FIELDS: Record<keyof BodyScanValues, number> = {
  weight: 400,
  skeletalMuscleMass: 150,
  bodyFatMass: 300,
  percentBodyFat: 80,
  bmi: 100,
  visceralFatLevel: 30,
  bmr: 6000,
  totalBodyWater: 150,
  ecwRatio: 1,
  inbodyScore: 150,
  softLeanMass: 200,
  protein: 50,
  mineral: 20,
  boneMineralContent: 15,
  bodyCellMass: 150,
  intracellularWater: 100,
  extracellularWater: 100,
  smi: 30,
  waistHipRatio: 3,
  waistCircumference: 300,
  visceralFatArea: 500,
  phaseAngle: 20,
};
export type ValueKey = keyof BodyScanValues;
export const VALUE_KEYS = Object.keys(FIELDS) as ValueKey[];

export const SEGMENTS = ["rightArm", "leftArm", "trunk", "rightLeg", "leftLeg"] as const satisfies (keyof Segmental)[];

export const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Same InBody test, same id: QR and CSV imports of one test land on one row. */
export const inbodyId = (measuredAt: number) => `inbody:${Math.floor(measuredAt / 60_000)}`;

export function blankScan(source: BodyScanInput["source"], measuredAt: number): BodyScanInput {
  const values = Object.fromEntries(VALUE_KEYS.map((k) => [k, null])) as BodyScanValues;
  return { ...values, measuredAt, source, externalId: null, device: null, segmentalLean: null, segmentalFat: null, segmentalEcw: null, raw: null };
}

/** At least two of weight / muscle / fat kg / fat %, so random data is not taken for a scan. */
export function hasComposition(scan: BodyScanValues): boolean {
  return [scan.weight, scan.skeletalMuscleMass, scan.bodyFatMass, scan.percentBodyFat].filter((v) => v != null).length >= 2;
}

/** ISO, epoch ms/s, InBody's compact `YYYYMMDD[HHmm[ss]]`, or `DD/MM/YYYY [HH:mm]`. Local time. */
export function parseDate(v: unknown): number | null {
  const s = String(v ?? "").trim();
  const local = (y: number, mo: number, d: number, h = 0, mi = 0, sec = 0) => {
    const at = new Date(y, mo - 1, d, h, mi, sec);
    return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d ? at.getTime() : null;
  };
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(s);
  if (compact && [8, 12, 14].includes(s.length)) return local(...(compact.slice(1).filter(Boolean).map(Number) as [number, number, number]));
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (dmy) {
    const [d, mo, y, h, mi, sec] = dmy.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
    return local(y!, mo!, d!, h, mi, sec);
  }
  const ymd = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (ymd) {
    const [y, mo, d, h, mi, sec] = ymd.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
    return local(y!, mo!, d!, h, mi, sec);
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : parsed;
}

/** "72,4" or "72.4" → 72.4; "-", "" and junk → null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Header/key to a comparable token: lowercase, no accents, no units in parentheses, alphanumerics only. */
export const normalizeKey = (key: string) =>
  key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

/** Normalized names a value goes by: InBody's English export headers, short codes, and Spanish. */
const ALIASES: Record<ValueKey, string[]> = {
  weight: ["weight", "wt", "bodyweight", "peso"],
  skeletalMuscleMass: ["skeletalmusclemass", "smm", "masamuscularesqueletica", "mme"],
  bodyFatMass: ["bodyfatmass", "bfm", "masadegrasacorporal", "masagrasacorporal", "masagrasa"],
  percentBodyFat: ["percentbodyfat", "pbf", "porcentajedegrasacorporal", "porcentajegrasacorporal", "pgc"],
  bmi: ["bmi", "bodymassindex", "imc", "indicedemasacorporal"],
  visceralFatLevel: ["visceralfatlevel", "vfl", "niveldegrasavisceral", "nivelgrasavisceral"],
  bmr: ["basalmetabolicrate", "bmr", "tasametabolicabasal", "tmb", "metabolismobasal"],
  totalBodyWater: ["totalbodywater", "tbw", "aguacorporaltotal", "act"],
  ecwRatio: ["ecwratio", "ecwtbw", "ratioaec", "aecact"],
  inbodyScore: ["inbodyscore", "score", "puntuacioninbody", "puntajeinbody"],
  softLeanMass: ["softleanmass", "slm", "masamagrablanda"],
  protein: ["protein", "proteina", "proteinas"],
  mineral: ["mineral", "minerals", "minerales"],
  boneMineralContent: ["bonemineralcontent", "bmc", "contenidomineraloseo"],
  bodyCellMass: ["bodycellmass", "bcm", "masacelularcorporal", "masacelular"],
  intracellularWater: ["intracellularwater", "icw", "aguaintracelular"],
  extracellularWater: ["extracellularwater", "ecw", "aguaextracelular"],
  smi: ["smi", "skeletalmuscleindex", "indicedemasamuscularesqueletica"],
  waistHipRatio: ["waisthipratio", "whr", "indicecinturacadera", "ratiocinturacadera"],
  waistCircumference: ["waistcircumference", "circunferenciadecintura", "perimetrodecintura"],
  visceralFatArea: ["visceralfatarea", "vfa", "areadegrasavisceral"],
  phaseAngle: ["wholebodyphaseangle", "phaseangle", "angulodefase"],
};
const DATE_KEYS = ["date", "fecha", "datetime", "fechayhora", "testdate", "testdatetime", "measuredat"];
const DEVICE_KEYS = ["measurementdevice", "device", "equipo", "dispositivo", "model"];
const SEGMENT_NAMES: Record<(typeof SEGMENTS)[number], [string, string]> = {
  rightArm: ["rightarm", "brazoderecho"],
  leftArm: ["leftarm", "brazoizquierdo"],
  trunk: ["trunk", "tronco"],
  rightLeg: ["rightleg", "piernaderecha"],
  leftLeg: ["leftleg", "piernaizquierda"],
};
const SEGMENTAL_KEYS: Record<"segmentalLean" | "segmentalFat" | "segmentalEcw", (en: string, es: string) => string[]> = {
  segmentalLean: (en, es) => [`${en}leanmass`, `leanmass${en}`, `masamagra${es}`, `masamagrade${es}`],
  segmentalFat: (en, es) => [`${en}fatmass`, `fatmass${en}`, `masagrasa${es}`, `masagrasade${es}`],
  segmentalEcw: (en, es) => [`${en}ecwratio`, `ecwratio${en}`, `ratioaec${es}`],
};

/**
 * A scan from named values (a CSV row, JSON, or a QR query string). Unknown
 * keys are ignored; the caller keeps the original in `raw`. `measuredAt` is
 * null when no date column was present or readable.
 */
export function readRecord(record: Record<string, unknown>, source: BodyScanInput["source"]): { scan: BodyScanInput; measuredAt: number | null } {
  const values = new Map(Object.entries(record).map(([k, v]) => [normalizeKey(k), v]));
  const pick = (keys: string[]) => keys.map((k) => values.get(k)).find((v) => v !== undefined && v !== null && v !== "");
  const dateValue = pick(DATE_KEYS);
  const measuredAt = dateValue === undefined ? null : parseDate(dateValue);
  const scan = blankScan(source, measuredAt ?? Date.now());
  for (const k of VALUE_KEYS) {
    const n = toNumber(pick(ALIASES[k]));
    scan[k] = n !== null && n > 0 && n <= FIELDS[k] ? n : null;
  }
  for (const [field, keys] of Object.entries(SEGMENTAL_KEYS) as [keyof typeof SEGMENTAL_KEYS, (typeof SEGMENTAL_KEYS)[keyof typeof SEGMENTAL_KEYS]][]) {
    const parts = SEGMENTS.map((s) => toNumber(pick(keys(...SEGMENT_NAMES[s]))));
    scan[field] = parts.every((n) => n !== null) ? (Object.fromEntries(SEGMENTS.map((s, i) => [s, parts[i]])) as Segmental) : null;
  }
  const device = pick(DEVICE_KEYS);
  scan.device = device === undefined ? null : String(device).trim().slice(0, 32) || null;
  return { scan, measuredAt };
}

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
