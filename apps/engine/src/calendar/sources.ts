/**
 * Read-only date-range reads of other features' tables, for what their stores
 * only expose as "latest N". Never writes.
 */
import { db } from "../db";
import { addDays, local, startOfDay } from "./time";

const bounds = (from: string, to: string) => [startOfDay(from), startOfDay(addDays(to, 1))] as const;

export type LoggedSession = { id: string; programId: string | null; dayId: string | null; name: string; startedAt: number; endedAt: number; date: string };

/** Strength sessions logged in Pulso that started in [from, to]. */
export function loggedSessions(from: string, to: string): LoggedSession[] {
  return db()
    .query<{ id: string; program_id: string | null; day_id: string | null; name: string; started_at: number; ended_at: number }, [number, number]>(
      "SELECT id, program_id, day_id, name, started_at, ended_at FROM training_sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at",
    )
    .all(...bounds(from, to))
    .map((r) => ({ id: r.id, programId: r.program_id, dayId: r.day_id, name: r.name, startedAt: r.started_at, endedAt: r.ended_at, date: local(r.started_at).date }));
}

export type HealthWorkout = { id: string; activity: string; startedAt: number; endedAt: number; energy: number | null; distance: number | null };

/** Canonical (non-duplicate) workouts from Apple Health that started in [from, to]. */
export function healthWorkouts(from: string, to: string): HealthWorkout[] {
  return db()
    .query<{ id: string; activity: string; started_at: number; ended_at: number; energy: number | null; distance: number | null }, [number, number]>(
      "SELECT id, activity, started_at, ended_at, energy, distance FROM workouts WHERE duplicate_of IS NULL AND started_at >= ? AND started_at < ? ORDER BY started_at",
    )
    .all(...bounds(from, to))
    .map((r) => ({ id: r.id, activity: r.activity, startedAt: r.started_at, endedAt: r.ended_at, energy: r.energy, distance: r.distance }));
}

export type ScanMarker = { id: string; measuredAt: number; weight: number | null; percentBodyFat: number | null; source: string };

/** Body scans (InBody and manual) measured in [from, to]. */
export function scansBetween(from: string, to: string): ScanMarker[] {
  return db()
    .query<{ id: string; measured_at: number; weight: number | null; percent_body_fat: number | null; source: string }, [number, number]>(
      "SELECT id, measured_at, weight, percent_body_fat, source FROM body_scans WHERE measured_at >= ? AND measured_at < ? ORDER BY measured_at",
    )
    .all(...bounds(from, to))
    .map((r) => ({ id: r.id, measuredAt: r.measured_at, weight: r.weight, percentBodyFat: r.percent_body_fat, source: r.source }));
}
