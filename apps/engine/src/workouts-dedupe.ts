import type { Database } from "bun:sqlite";

type Candidate = { id: string; activity: string; started_at: number; ended_at: number; energy: number | null; distance: number | null; source_bundle?: string | null };

/**
 * Pulso's own copies of its sessions (written on finish) are never one of two
 * recordings: merged here, the Watch's workout of the same session could be
 * the one dropped. workouts-merge folds them into their session instead.
 */
/**
 * The phone app: `com.facundo.pulso` and the Debug build's `com.facundo.pulso.dev`.
 * Not Pulso's Watch app (`….watchkitapp`): it records the session live, with
 * heart rate, like the Workout app, so its workouts are real recordings.
 */
export const PULSO_BUNDLE = /^com\.facundo\.pulso(\.dev)?$/;

/** Fraction of the shorter workout covered by the other. */
export function overlap(a: Pick<Candidate, "started_at" | "ended_at">, b: Pick<Candidate, "started_at" | "ended_at">): number {
  const shared = Math.min(a.ended_at, b.ended_at) - Math.max(a.started_at, b.started_at);
  const shorter = Math.min(a.ended_at - a.started_at, b.ended_at - b.started_at);
  return shared > 0 && shorter > 0 ? shared / shorter : 0;
}

/** More measurements win, then the longer recording; ids break ties so the outcome never depends on row order. */
const compare = (a: Candidate, b: Candidate) => {
  const data = (w: Candidate) => [w.energy, w.distance].filter((v) => v !== null && v > 0).length;
  return data(b) - data(a) || b.ended_at - b.started_at - (a.ended_at - a.started_at) || a.started_at - b.started_at || a.id.localeCompare(b.id);
};

/**
 * Same-activity workouts that overlap by more than half of the shorter one are
 * one session recorded twice. Returns `id → canonical id` for every duplicate.
 */
export function findDuplicates(workouts: Candidate[]): Map<string, string> {
  const canonical: Candidate[] = [];
  const duplicateOf = new Map<string, string>();
  for (const w of [...workouts].filter((w) => !w.source_bundle || !PULSO_BUNDLE.test(w.source_bundle)).sort(compare)) {
    const original = canonical.find((c) => c.activity === w.activity && overlap(c, w) > 0.5);
    if (original) duplicateOf.set(w.id, original.id);
    else canonical.push(w);
  }
  return duplicateOf;
}

/** Recomputes `duplicate_of` for every workout. Idempotent; only rows whose link changed are written. */
export function linkDuplicates(database: Database): void {
  const rows = database
    .query<Candidate & { duplicate_of: string | null }, []>("SELECT id, activity, started_at, ended_at, energy, distance, source_bundle, duplicate_of FROM workouts")
    .all();
  const duplicates = findDuplicates(rows);
  const update = database.query("UPDATE workouts SET duplicate_of = ? WHERE id = ?");
  database.transaction(() => {
    for (const row of rows) {
      const next = duplicates.get(row.id) ?? null;
      if (next !== row.duplicate_of) update.run(next, row.id);
    }
  })();
}
