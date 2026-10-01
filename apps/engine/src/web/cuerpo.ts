/**
 * What the web app's Cuerpo page draws: the latest scan with how it moved,
 * every scan for the history and trends, the four projections, goals and the
 * profile fields that describe the body. Read-only; the page and
 * `GET /api/web/cuerpo` share it.
 */
import { BODY_METRICS, type BodyGoal, type BodyMetric, type BodyProjection, type BodyScan, type Profile } from "@pulso/contract";
import { getProfile } from "../agent/profile";
import { listGoals, listScans, projections } from "../body/store";

/** A metric's newest value across scans, and how it moved since the scan before that one that also measured it. */
export type BodyReading = {
  value: number;
  at: number;
  /** null for the first reading */
  delta: number | null;
  since: number | null;
};

export type BodyOverview = {
  latest: BodyScan | null;
  /** per metric; null when no scan has it. A weight-only entry does not blank fat or muscle. */
  readings: Record<BodyMetric, BodyReading | null>;
  /** newest first, without raw payloads */
  scans: BodyScan[];
  projections: BodyProjection[];
  goals: BodyGoal[];
  profile: Profile;
};

const SCANS = 200;

export function bodyReadings(scans: BodyScan[]): BodyOverview["readings"] {
  const reading = (metric: BodyMetric): BodyReading | null => {
    const [now, before] = scans.filter((s) => s[metric] != null);
    if (!now) return null;
    const value = now[metric]!;
    return { value, at: now.measuredAt, delta: before ? Math.round((value - before[metric]!) * 100) / 100 : null, since: before?.measuredAt ?? null };
  };
  return Object.fromEntries(BODY_METRICS.map((m) => [m, reading(m)])) as BodyOverview["readings"];
}

export function bodyOverview(): BodyOverview {
  const scans = listScans(SCANS).map((scan) => ({ ...scan, raw: null }));
  return {
    latest: scans[0] ?? null,
    readings: bodyReadings(scans),
    scans,
    projections: projections(),
    goals: listGoals(),
    profile: getProfile(),
  };
}
