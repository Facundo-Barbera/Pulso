import { randomUUID } from "node:crypto";
import type { HeartRatePoint, Workout, WorkoutInput } from "@pulso/contract";
import { db } from "./db";
import { linkDuplicates } from "./workouts-dedupe";

export type WorkoutRow = {
  id: string;
  external_id: string | null;
  source: Workout["source"];
  activity: string;
  started_at: number;
  ended_at: number;
  energy: number | null;
  distance: number | null;
  source_bundle: string | null;
  source_name: string | null;
  external_ref: string | null;
  avg_hr: number | null;
  max_hr: number | null;
};

/** Every column but the heart-rate series, which only a session's detail reads. */
export const WORKOUT_COLUMNS =
  "id, external_id, source, activity, started_at, ended_at, energy, distance, source_bundle, source_name, external_ref, avg_hr, max_hr";

export const toWorkout = (row: WorkoutRow): Workout => ({
  id: row.id,
  externalId: row.external_id,
  source: row.source,
  activity: row.activity,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  energy: row.energy,
  distance: row.distance,
  sourceBundle: row.source_bundle,
  sourceName: row.source_name,
  externalRef: row.external_ref,
  avgHeartRate: row.avg_hr,
  maxHeartRate: row.max_hr,
});

/**
 * Newest first. One entry per real recording: copies of the same workout by
 * several apps stay stored (linked by `duplicate_of`) but are not returned.
 * Workouts that are part of a Pulso session are still here; `standaloneWorkouts`
 * in workouts-merge leaves them out.
 */
export function listWorkouts(limit = 50, before = Number.MAX_SAFE_INTEGER): Workout[] {
  return db()
    .query<WorkoutRow, [number, number]>(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE duplicate_of IS NULL AND started_at < ? ORDER BY started_at DESC LIMIT ?`)
    .all(before, limit)
    .map(toWorkout);
}

/** Canonical workouts overlapping [from, to), oldest first. */
export function workoutsBetween(from: number, to: number): Workout[] {
  return db()
    .query<WorkoutRow, [number, number]>(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE duplicate_of IS NULL AND ended_at >= ? AND started_at < ? ORDER BY started_at`)
    .all(from, to)
    .map(toWorkout);
}

export function workoutsByIds(ids: string[]): Workout[] {
  if (ids.length === 0) return [];
  return db()
    .query<WorkoutRow, string[]>(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids)
    .map(toWorkout);
}

/** The stored heart-rate series of each workout that has one. */
export function heartRates(ids: string[]): Map<string, HeartRatePoint[]> {
  if (ids.length === 0) return new Map();
  const rows = db()
    .query<{ id: string; heart_rate: string }, string[]>(`SELECT id, heart_rate FROM workouts WHERE heart_rate IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  return new Map(rows.map((r) => [r.id, JSON.parse(r.heart_rate) as HeartRatePoint[]]));
}

/**
 * Upsert by HealthKit UUID, so re-syncing the same window is harmless, then
 * re-link duplicates. A sync without source, metadata or heart rate (an older
 * phone) keeps what is stored. Returns how many were written.
 */
export function upsertHealthKitWorkouts(inputs: WorkoutInput[]): number {
  const statement = db().query(
    `INSERT INTO workouts (id, external_id, source, activity, started_at, ended_at, energy, distance, source_bundle, source_name, external_ref, avg_hr, max_hr, heart_rate)
     VALUES (?, ?, 'healthkit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id) DO UPDATE SET
       activity = excluded.activity, started_at = excluded.started_at, ended_at = excluded.ended_at,
       energy = excluded.energy, distance = excluded.distance,
       source_bundle = COALESCE(excluded.source_bundle, workouts.source_bundle),
       source_name = COALESCE(excluded.source_name, workouts.source_name),
       external_ref = COALESCE(excluded.external_ref, workouts.external_ref),
       avg_hr = COALESCE(excluded.avg_hr, workouts.avg_hr),
       max_hr = COALESCE(excluded.max_hr, workouts.max_hr),
       heart_rate = COALESCE(excluded.heart_rate, workouts.heart_rate)`,
  );
  const write = db().transaction((items: WorkoutInput[]) => {
    for (const w of items) {
      statement.run(
        randomUUID(),
        w.externalId,
        w.activity,
        w.startedAt,
        w.endedAt,
        w.energy,
        w.distance,
        w.sourceBundle ?? null,
        w.sourceName ?? null,
        w.externalRef ?? null,
        w.avgHeartRate ?? null,
        w.maxHeartRate ?? null,
        w.heartRate?.length ? JSON.stringify(w.heartRate) : null,
      );
    }
    linkDuplicates(db());
    return items.length;
  });
  return write(inputs);
}

/** Enough for a few hours at one point a minute. */
const MAX_HEART_RATE_POINTS = 600;

/** Validates an untrusted body from the phone. Returns undefined when any item is malformed. */
export function parseWorkoutInputs(body: unknown): WorkoutInput[] | undefined {
  const items = (body as { workouts?: unknown })?.workouts;
  if (!Array.isArray(items) || items.length > 1000) return undefined;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const optNum = (v: unknown) => v === null || v === undefined || num(v);
  const optText = (v: unknown) => v === null || v === undefined || typeof v === "string";
  const parsed: WorkoutInput[] = [];
  for (const item of items as Record<string, unknown>[]) {
    if (typeof item?.externalId !== "string" || typeof item.activity !== "string") return undefined;
    if (!num(item.startedAt) || !num(item.endedAt) || !optNum(item.energy) || !optNum(item.distance)) return undefined;
    if (!optText(item.sourceBundle) || !optText(item.sourceName) || !optText(item.externalRef)) return undefined;
    if (!optNum(item.avgHeartRate) || !optNum(item.maxHeartRate)) return undefined;
    const series = item.heartRate;
    if (series !== null && series !== undefined) {
      if (!Array.isArray(series) || series.length > MAX_HEART_RATE_POINTS) return undefined;
      if (!series.every((p: Record<string, unknown>) => num(p?.at) && num(p?.bpm))) return undefined;
    }
    parsed.push({
      externalId: item.externalId,
      activity: item.activity.slice(0, 64),
      startedAt: item.startedAt as number,
      endedAt: item.endedAt as number,
      energy: (item.energy as number | null | undefined) ?? null,
      distance: (item.distance as number | null | undefined) ?? null,
      sourceBundle: (item.sourceBundle as string | null | undefined)?.slice(0, 128) ?? null,
      sourceName: (item.sourceName as string | null | undefined)?.slice(0, 128) ?? null,
      externalRef: (item.externalRef as string | null | undefined)?.slice(0, 128) ?? null,
      avgHeartRate: (item.avgHeartRate as number | null | undefined) ?? null,
      maxHeartRate: (item.maxHeartRate as number | null | undefined) ?? null,
      heartRate: (series as { at: number; bpm: number }[] | null | undefined)?.map((p) => ({ at: p.at, bpm: p.bpm })) ?? null,
    });
  }
  return parsed;
}
