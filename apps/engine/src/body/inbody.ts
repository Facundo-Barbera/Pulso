/**
 * InBody result-sheet QR parser.
 *
 * The QR on an InBody sheet or screen is a URL like
 * `https://qrcode.inbody.com?IBData=<model>-<serial>!…`: one opaque string
 * of `!`-separated segments holding fixed-width ASCII digits. Offsets differ
 * per model, so each model we read is an entry in `IBDATA_LAYOUTS`.
 * Named values (`?WT=72.4&SMM=33.1`, JSON) are read by key aliases as a
 * fallback. Anything else fails with a code; the caller keeps the raw payload.
 */
import { createHash } from "node:crypto";
import type { BodyScanInput, Segmental } from "@pulso/contract";
import { blankScan, hasComposition, inbodyId, parseDate, readRecord, SEGMENTS, type ValueKey } from "./fields";

type ParseFailure = { ok: false; code: "unknown_inbody_format" | "unmapped_ibdata"; message: string };
export type ParseResult = { ok: true; scan: BodyScanInput } | ParseFailure;

/** One value inside an IBData segment: digits at [offset, offset+length), times `scale`. */
export type IBDataField = { part: number; offset: number; length: number; scale: number };
export type IBDataLayout = {
  name: string;
  /** Recognises this model's payloads by segment count and lengths. */
  matches: (parts: string[]) => boolean;
  fields: Partial<Record<ValueKey, IBDataField>>;
  segmentalLean?: Record<keyof Segmental, IBDataField>;
  segmentalFat?: Record<keyof Segmental, IBDataField>;
  /** `YYYYMMDDHHmmss` digits: the test time. */
  date?: { part: number; offset: number };
};

const at = (part: number, offset: number, scale: number, length = 4): IBDataField => ({ part, offset, length, scale });

/**
 * InBody 270 (39 segments). Mapped from one real QR with no printed sheet, so
 * each offset had to agree with the others: BMI = weight / height² (height
 * at 33:0), BFM = weight × PBF, TBW + protein + mineral = FFM (33:71),
 * BMR = 370 + 21.6 × FFM, Σ segmental lean ≈ FFM, Σ segmental fat ≈ BFM,
 * SMI = (arms + legs lean) / height². Segment 33 keeps each value beside its
 * normal range (value, low, high). Not mapped: visceral fat level and InBody
 * score (no candidate passed a cross-check). The 270 reports no ECW ratio.
 */
const INBODY_270: IBDataLayout = {
  name: "InBody 270",
  matches: (parts) => parts.length === 39 && /^270-/.test(parts[0] ?? "") && (parts[33]?.length ?? 0) >= 112 && (parts[38]?.length ?? 0) >= 109,
  date: { part: 33, offset: 9 },
  fields: {
    protein: at(33, 23, 0.1),
    mineral: at(33, 35, 0.01),
    bodyFatMass: at(33, 47, 0.1),
    totalBodyWater: at(33, 59, 0.1),
    weight: at(33, 75, 0.1),
    skeletalMuscleMass: at(33, 91, 0.1),
    bmi: at(33, 104, 0.1),
    percentBodyFat: at(33, 108, 0.1),
    bmr: at(34, 4, 1),
    waistHipRatio: at(34, 8, 0.01),
    smi: at(38, 105, 0.1),
  },
  segmentalLean: {
    rightArm: at(38, 20, 0.01),
    leftArm: at(38, 24, 0.01),
    trunk: at(38, 28, 0.1),
    rightLeg: at(38, 32, 0.01),
    leftLeg: at(38, 36, 0.01),
  },
  segmentalFat: {
    rightArm: at(38, 40, 0.1),
    leftArm: at(38, 44, 0.1),
    trunk: at(38, 48, 0.1),
    rightLeg: at(38, 52, 0.1),
    leftLeg: at(38, 56, 0.1),
  },
};

/** Models whose IBData we can read. */
export const IBDATA_LAYOUTS: IBDataLayout[] = [INBODY_270];

/** Fixed-width ASCII digits to a number; null when the slice is not all digits. */
export function decodeDigits(slice: string, scale: number): number | null {
  return /^\d+$/.test(slice) ? Math.round(Number(slice) * scale * 1000) / 1000 : null;
}

const hashId = (payload: string) => `inbody:${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;

function fromIBData(ibdata: string, payload: string, now: number, layouts: IBDataLayout[]): ParseResult {
  const parts = ibdata.split("!");
  const layout = layouts.find((l) => l.matches(parts));
  if (!layout) {
    const model = /^(\w+)-/.exec(parts[0] ?? "")?.[1];
    return {
      ok: false,
      code: "unmapped_ibdata",
      message: `Es un QR de InBody${model ? ` ${model}` : ""}, pero todavía no sé leer ese modelo. Lo guardé para mapearlo; mientras, carga los valores a mano.`,
    };
  }
  // All-zero digits mean "not measured" on these sheets.
  const read = (f: IBDataField) => decodeDigits(parts[f.part]?.slice(f.offset, f.offset + f.length) ?? "", f.scale) || null;
  const measuredAt = layout.date ? parseDate(parts[layout.date.part]?.slice(layout.date.offset, layout.date.offset + 14)) : null;
  const scan = blankScan("inbody", measuredAt ?? now);
  scan.externalId = measuredAt ? inbodyId(measuredAt) : hashId(payload);
  scan.device = /^(\w+)-/.exec(parts[0] ?? "")?.[1] ?? null;
  scan.raw = payload;
  for (const [key, f] of Object.entries(layout.fields) as [ValueKey, IBDataField][]) scan[key] = read(f);
  for (const key of ["segmentalLean", "segmentalFat"] as const) {
    const fields = layout[key];
    const values = fields && SEGMENTS.map((s) => read(fields[s]));
    scan[key] = values?.every((v) => v !== null) ? (Object.fromEntries(SEGMENTS.map((s, i) => [s, values[i]])) as Segmental) : null;
  }
  return hasComposition(scan)
    ? { ok: true, scan }
    : { ok: false, code: "unmapped_ibdata", message: `El QR del ${layout.name} no trajo los valores esperados. Lo guardé.` };
}

function fromNamedValues(record: Record<string, unknown>, payload: string, now: number): ParseResult {
  const { scan, measuredAt } = readRecord(record, "inbody");
  if (!hasComposition(scan)) return unknown();
  scan.measuredAt = measuredAt ?? now;
  scan.externalId = measuredAt ? inbodyId(measuredAt) : hashId(payload);
  scan.raw = payload;
  return { ok: true, scan };
}

const unknown = (): ParseFailure => ({
  ok: false,
  code: "unknown_inbody_format",
  message: "No reconozco este QR como un resultado de InBody. Lo guardé; puedes cargar los valores a mano.",
});

export function parseInBody(text: string, options: { now?: number; layouts?: IBDataLayout[] } = {}): ParseResult {
  const payload = text.trim();
  const now = options.now ?? Date.now();
  const layouts = options.layouts ?? IBDATA_LAYOUTS;
  if (!payload) return unknown();

  if (payload.startsWith("{")) {
    try {
      return fromNamedValues(JSON.parse(payload) as Record<string, unknown>, payload, now);
    } catch {
      return unknown();
    }
  }

  // URL or bare query string. URLSearchParams also undoes `%21` (an encoded `!`), which would shift every offset.
  const query = /^[a-z][a-z0-9+.-]*:\/\//i.test(payload) ? payload.slice(payload.indexOf("?") + 1 || payload.length) : payload;
  const params = new URLSearchParams(query.split("#")[0]!);
  for (const [key, value] of params) {
    if (key.toLowerCase() === "ibdata") return fromIBData(value, payload, now, layouts);
  }
  return fromNamedValues(Object.fromEntries(params), payload, now);
}
