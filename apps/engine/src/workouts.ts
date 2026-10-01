import { randomUUID } from "node:crypto";
import type { Workout, WorkoutInput } from "@pulso/contract";
import { db } from "./db";
import { linkDuplicates } from "./workouts-dedupe";

type Row = {
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
};

const toWorkout = (row: Row): Workout => ({
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
});

/**
 * Newest first. One entry per real session: recordings of the same session by
 * several apps stay stored (linked by `duplicate_of`) but are not returned.
 */
export function listWorkouts(limit = 50): Workout[] {
  return db()
    .query<Row, [number]>("SELECT * FROM workouts WHERE duplicate_of IS NULL ORDER BY started_at DESC LIMIT ?")
    .all(limit)
    .map(toWorkout);
}

/**
 * Upsert by HealthKit UUID, so re-syncing the same window is harmless, then
 * re-link duplicates. A sync without source info keeps the stored source.
 * Returns how many were written.
 */
export function upsertHealthKitWorkouts(inputs: WorkoutInput[]): number {
  const statement = db().query(
    `INSERT INTO workouts (id, external_id, source, activity, started_at, ended_at, energy, distance, source_bundle, source_name)
     VALUES (?, ?, 'healthkit', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (external_id) DO UPDATE SET
       activity = excluded.activity, started_at = excluded.started_at, ended_at = excluded.ended_at,
       energy = excluded.energy, distance = excluded.distance,
       source_bundle = COALESCE(excluded.source_bundle, workouts.source_bundle),
       source_name = COALESCE(excluded.source_name, workouts.source_name)`,
  );
  const write = db().transaction((items: WorkoutInput[]) => {
    for (const w of items) {
      statement.run(randomUUID(), w.externalId, w.activity, w.startedAt, w.endedAt, w.energy, w.distance, w.sourceBundle ?? null, w.sourceName ?? null);
    }
    linkDuplicates(db());
    return items.length;
  });
  return write(inputs);
}

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
    if (!optText(item.sourceBundle) || !optText(item.sourceName)) return undefined;
    parsed.push({
      externalId: item.externalId,
      activity: item.activity.slice(0, 64),
      startedAt: item.startedAt as number,
      endedAt: item.endedAt as number,
      energy: (item.energy as number | null | undefined) ?? null,
      distance: (item.distance as number | null | undefined) ?? null,
      sourceBundle: (item.sourceBundle as string | null | undefined)?.slice(0, 128) ?? null,
      sourceName: (item.sourceName as string | null | undefined)?.slice(0, 128) ?? null,
    });
  }
  return parsed;
}
