import type { ExerciseKind } from "@pulso/contract";

type Member = { kind: ExerciseKind; supersetId?: string | null };

/**
 * The superset id each exercise of a list really has: a superset is a run of
 * two or more consecutive strength exercises with the same id. Cardio, lone
 * members and members cut off from their group get null; when an id is used
 * by runs that aren't adjacent, only the first run of two or more keeps it.
 */
export function supersetIds(list: Member[]): (string | null)[] {
  const ids = list.map((e) => (e.kind === "cardio" ? null : e.supersetId?.trim() || null));
  const out: (string | null)[] = ids.map(() => null);
  const used = new Set<string>();
  for (let start = 0; start < ids.length; ) {
    const id = ids[start];
    let end = start + 1;
    while (id != null && ids[end] === id) end++;
    if (id != null && end - start >= 2 && !used.has(id)) {
      used.add(id);
      out.fill(id, start, end);
    }
    start = end;
  }
  return out;
}

/** The list with its superset ids normalized (see `supersetIds`). */
export function withSupersets<T extends Member>(list: T[]): (T & { supersetId: string | null })[] {
  const ids = supersetIds(list);
  return list.map((e, i) => ({ ...e, supersetId: ids[i]! }));
}
