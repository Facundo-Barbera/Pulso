import type { SetSegment, SetSegments, WeightUnit } from "@pulso/contract";
import { formatWeight, fromUnit, shown, snap, stepDown, toUnit } from "./units";

/**
 * Sets where the load dropped mid-set ("80 kg × 5 → 60 kg × 3"). A set's flat
 * `weightKg`/`reps` are its top segment and win over `segments[0]`; later
 * segments follow. Volume and reps count every segment; records, e1RM and
 * progression read the top one (the flat fields), so they ignore drops.
 * Pure, so the web's client components use it too.
 */

type AnySet = { weightKg: number; reps: number } & SetSegments;

/** Every segment, top first: the flat fields, then the later segments that have reps. */
export function segmentsOf(set: AnySet): SetSegment[] {
  const drops = (set.segments ?? []).slice(1).filter((s) => s.reps > 0);
  return [{ weightKg: set.weightKg, reps: set.reps }, ...drops.map(({ weightKg, reps }) => ({ weightKg, reps }))];
}

/** The set with `segments` rebuilt from its flat fields. */
export const withSegments = <T extends AnySet>(set: T): T & { segments: SetSegment[] } => ({ ...set, segments: segmentsOf(set) });

export const hasDrops = (set: AnySet) => segmentsOf(set).length > 1;

/** kg × reps over every segment. */
export const volumeOf = (set: AnySet) => segmentsOf(set).reduce((n, s) => n + s.weightKg * s.reps, 0);

/** Reps over every segment. */
export const repsOf = (set: AnySet) => segmentsOf(set).reduce((n, s) => n + s.reps, 0);

/** "80 kg × 5 → 60 kg × 3" in the exercise's unit; a bodyweight segment reads "8 reps". */
export const formatSet = (set: AnySet, unit: WeightUnit) =>
  segmentsOf(set)
    .map((s) => (s.weightKg > 0 ? `${formatWeight(s.weightKg, unit)} × ${s.reps}` : `${s.reps} reps`))
    .join(" → ");

const number = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });

/** "80 × 5 → 60 × 3": numbers only, in `unit`, for a row whose header names the unit. */
export const formatSetShort = (set: AnySet, unit: WeightUnit) =>
  segmentsOf(set)
    .map((s) => (s.weightKg > 0 ? `${number.format(shown(s.weightKg, unit))} × ${s.reps}` : `${s.reps} reps`))
    .join(" → ");

/** How much lighter a suggested drop is: about 15 %, so it lands between 10 and 20 % on most loads. */
const DROP = 0.85;

/**
 * The segment to add after a set's last one: about 15 % lighter, on the steps
 * of the exercise's unit (always at least one step down), for the reps still
 * missing to `repMin` (at least 1).
 */
export function nextDrop(set: AnySet, repMin: number, unit: WeightUnit): SetSegment {
  const last = segmentsOf(set).at(-1)!;
  const reps = Math.max(1, repMin - repsOf(set));
  if (last.weightKg <= 0) return { weightKg: 0, reps };
  const value = snap(last.weightKg, unit);
  const target = toUnit(last.weightKg, unit) * DROP;
  // Whole steps down from the top (the grid the machine has), to the step nearest the target.
  let above = stepDown(value, unit);
  let below = above;
  while (below > target && below > 0) [above, below] = [below, stepDown(below, unit)];
  const weight = above - target <= target - below ? above : below;
  return { weightKg: fromUnit(weight, unit), reps };
}

/**
 * "¿Bajaste el peso para terminarla?": a strength set just checked off short
 * of the target's bottom, with a load and no drop yet, gets the offer of
 * `nextDrop`. Null when it met the target (or can't drop).
 */
export function dropOffer(set: AnySet, repMin: number, unit: WeightUnit): SetSegment | null {
  if (hasDrops(set) || set.weightKg <= 0 || set.reps <= 0 || set.reps >= repMin) return null;
  const drop = nextDrop(set, repMin, unit);
  return drop.weightKg > 0 && drop.weightKg < set.weightKg ? drop : null;
}
