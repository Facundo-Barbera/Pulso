import { randomUUID } from "node:crypto";
import { BODY_METRICS, type BodyGoal, type BodyMetric, type BodyProjection, type BodySample, type BodyScan, type BodyScanInput, type BodyScanValues, type InBodyParse, type Segmental } from "@pulso/contract";
import { z } from "zod";
import { db } from "../db";
import { FIELDS, hasComposition, round, snake, VALUE_KEYS } from "./fields";
import { parseInBody } from "./inbody";
import { project } from "./projection";

type Row = Record<string, string | number | null>;

const SEGMENTAL = ["segmentalLean", "segmentalFat", "segmentalEcw"] as const;
const COLUMNS = ["external_id", "source", "device", "measured_at", ...VALUE_KEYS.map(snake), ...SEGMENTAL.map(snake), "raw"];

const toScan = (row: Row): BodyScan => {
  const json = (column: string) => (row[column] ? (JSON.parse(row[column] as string) as Segmental) : null);
  return {
    ...(Object.fromEntries(VALUE_KEYS.map((k) => [k, row[snake(k)] as number | null])) as BodyScanValues),
    id: row.id as string,
    measuredAt: row.measured_at as number,
    source: row.source as BodyScan["source"],
    externalId: row.external_id as string | null,
    device: row.device as string | null,
    segmentalLean: json("segmental_lean"),
    segmentalFat: json("segmental_fat"),
    segmentalEcw: json("segmental_ecw"),
    raw: row.raw as string | null,
  };
};

const segmental = z.object({
  rightArm: z.number().min(0).max(200),
  leftArm: z.number().min(0).max(200),
  trunk: z.number().min(0).max(200),
  rightLeg: z.number().min(0).max(200),
  leftLeg: z.number().min(0).max(200),
});

/** Validates a scan from the phone or the agent. Needs two of weight / muscle / fat kg / fat %. */
export const scanInputSchema = z
  .object({
    measuredAt: z.number().int().positive().optional(),
    source: z.enum(["inbody", "manual"]).default("manual"),
    externalId: z.string().max(128).nullable().optional(),
    device: z.string().max(32).nullable().optional(),
    ...Object.fromEntries(VALUE_KEYS.map((k) => [k, z.number().positive().max(FIELDS[k]).nullable().optional()])),
    segmentalLean: segmental.nullable().optional(),
    segmentalFat: segmental.nullable().optional(),
    segmentalEcw: segmental.nullable().optional(),
    raw: z.string().max(20_000).nullable().optional(),
  })
  .transform((s): BodyScanInput => {
    const input = s as Record<string, unknown>;
    return {
      ...(Object.fromEntries(VALUE_KEYS.map((k) => [k, (input[k] as number | null | undefined) ?? null])) as BodyScanValues),
      measuredAt: s.measuredAt ?? Date.now(),
      source: s.source,
      externalId: s.externalId ?? null,
      device: s.device ?? null,
      segmentalLean: s.segmentalLean ?? null,
      segmentalFat: s.segmentalFat ?? null,
      segmentalEcw: s.segmentalEcw ?? null,
      raw: s.raw ?? null,
    };
  })
  .refine((s) => s.weight != null || hasComposition(s), { message: "a scan needs weight, or two of muscle / fat kg / fat %" });

export function listScans(limit = 100): BodyScan[] {
  return db().query<Row, [number]>("SELECT * FROM body_scans ORDER BY measured_at DESC LIMIT ?").all(limit).map(toScan);
}

/** Fills in what the sheet implies but did not say, so the fat kg and fat % series are as complete as the data allows. */
function complete(s: BodyScanInput): BodyScanInput {
  const out = { ...s };
  if (out.bodyFatMass == null && out.weight != null && out.percentBodyFat != null) out.bodyFatMass = round((out.weight * out.percentBodyFat) / 100, 1);
  if (out.percentBodyFat == null && out.weight != null && out.bodyFatMass != null) out.percentBodyFat = round((out.bodyFatMass / out.weight) * 100, 1);
  return out;
}

const upsertSql = `INSERT INTO body_scans (id, ${COLUMNS.join(", ")}) VALUES (?, ${COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT (external_id) DO UPDATE SET ${COLUMNS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}
  RETURNING *`;

/** Inserts, or replaces the scan with the same `externalId`, so re-importing one test never duplicates it. */
export function addScan(input: BodyScanInput): BodyScan {
  const s = complete(input);
  const values = [
    s.externalId, s.source, s.device, s.measuredAt,
    ...VALUE_KEYS.map((k) => s[k]),
    ...SEGMENTAL.map((k) => (s[k] ? JSON.stringify(s[k]) : null)),
    s.raw,
  ];
  return toScan(db().query<Row, (string | number | null)[]>(upsertSql).get(randomUUID(), ...values)!);
}

export function addScans(inputs: BodyScanInput[]): number {
  return db().transaction((items: BodyScanInput[]) => items.map(addScan).length)(inputs);
}

export function deleteScan(id: string): boolean {
  return db().query("DELETE FROM body_scans WHERE id = ?").run(id).changes > 0;
}

export const samplesSchema = z.object({
  samples: z
    .array(
      z.object({
        externalId: z.string().min(1).max(128),
        metric: z.enum(["weight", "percentBodyFat"]),
        value: z.number().positive().max(400),
        measuredAt: z.number().int().positive(),
      }),
    )
    .max(5000),
});

/** HealthKit samples, upserted by UUID. HealthKit stores body fat as a fraction; the phone sends %. */
export function upsertSamples(samples: BodySample[]): number {
  const statement = db().query(
    `INSERT INTO body_samples (external_id, metric, value, measured_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (external_id) DO UPDATE SET metric = excluded.metric, value = excluded.value, measured_at = excluded.measured_at`,
  );
  return db().transaction((items: BodySample[]) => {
    for (const s of items) statement.run(s.externalId, s.metric, s.value, s.measuredAt);
    return items.length;
  })(samples);
}

/** Every reading of one metric, scans and HealthKit samples together, oldest first. */
export function series(metric: BodyMetric): { at: number; value: number }[] {
  const column = snake(metric);
  return db()
    .query<{ at: number; value: number }, [string]>(
      `SELECT measured_at AS at, ${column} AS value FROM body_scans WHERE ${column} IS NOT NULL
       UNION ALL
       SELECT measured_at AS at, value FROM body_samples WHERE metric = ?
       ORDER BY at`,
    )
    .all(metric);
}

export function listGoals(): BodyGoal[] {
  return db()
    .query<{ metric: BodyMetric; target: number; set_at: number }, []>("SELECT * FROM body_goals ORDER BY metric")
    .all()
    .map((g) => ({ metric: g.metric, target: g.target, setAt: g.set_at }));
}

/** One goal per metric; `null` clears it. */
export function setGoal(metric: BodyMetric, target: number | null): BodyGoal | null {
  if (target === null) {
    db().query("DELETE FROM body_goals WHERE metric = ?").run(metric);
    return null;
  }
  const setAt = Date.now();
  db()
    .query("INSERT INTO body_goals (metric, target, set_at) VALUES (?, ?, ?) ON CONFLICT (metric) DO UPDATE SET target = excluded.target, set_at = excluded.set_at")
    .run(metric, target, setAt);
  return { metric, target, setAt };
}

/** Parses a QR payload without saving the scan. Payloads we cannot read are kept so a later parser can retry them. */
export function readInBodyQr(payload: string): InBodyParse {
  const parsed = parseInBody(payload);
  if (parsed.ok) return parsed;
  db()
    .query("INSERT INTO inbody_payloads (id, payload, error, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (payload) DO UPDATE SET error = excluded.error")
    .run(randomUUID(), payload.trim(), parsed.code, Date.now());
  const { id } = db().query<{ id: string }, [string]>("SELECT id FROM inbody_payloads WHERE payload = ?").get(payload.trim())!;
  return { ...parsed, payloadId: id };
}

/** Projection for one metric against its stored goal, or against `target` when given (without saving it). */
export function projection(metric: BodyMetric, target?: number): BodyProjection {
  const goal = target !== undefined ? { metric, target, setAt: Date.now() } : listGoals().find((g) => g.metric === metric);
  return project(metric, series(metric), goal);
}

export const projections = (): BodyProjection[] => BODY_METRICS.map((m) => projection(m));
