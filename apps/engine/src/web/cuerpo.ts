/**
 * What the web app's Cuerpo page draws: the latest scan with how it moved,
 * every scan for the history and trends, the four projections, goals and the
 * profile fields that describe the body. Read-only; the page and
 * `GET /api/web/cuerpo` share it.
 */
import { BODY_METRICS, type BodyGoal, type BodyMetric, type BodyProjection, type BodyScan, type Profile } from "@pulso/contract";
import { getProfile } from "../agent/profile";
import { listGoals, listScans, projections } from "../body/store";

export type BodyChange = {
  /** latest value minus the newest earlier scan that has this metric */
  delta: number;
  /** when that earlier scan was taken */
  since: number;
};

export type BodyOverview = {
  latest: BodyScan | null;
  /** per metric; null when the latest scan or every earlier one lacks it */
  changes: Record<BodyMetric, BodyChange | null>;
  /** newest first, without raw payloads */
  scans: BodyScan[];
  projections: BodyProjection[];
  goals: BodyGoal[];
  profile: Profile;
};

const SCANS = 200;

export function bodyChanges(scans: BodyScan[]): BodyOverview["changes"] {
  const [latest, ...earlier] = scans;
  const change = (metric: BodyMetric): BodyChange | null => {
    const now = latest?.[metric];
    const before = earlier.find((s) => s[metric] != null);
    if (now == null || !before) return null;
    return { delta: Math.round((now - before[metric]!) * 100) / 100, since: before.measuredAt };
  };
  return Object.fromEntries(BODY_METRICS.map((m) => [m, change(m)])) as BodyOverview["changes"];
}

export function bodyOverview(): BodyOverview {
  const scans = listScans(SCANS).map((scan) => ({ ...scan, raw: null }));
  return {
    latest: scans[0] ?? null,
    changes: bodyChanges(scans),
    scans,
    projections: projections(),
    goals: listGoals(),
    profile: getProfile(),
  };
}
