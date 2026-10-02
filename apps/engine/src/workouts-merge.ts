/**
 * Health workouts merged into the Pulso sessions they were recorded during.
 *
 * One gym visit often reaches Salud three times: the Pulso session (and the
 * copy Pulso itself writes on finish), the Watch's strength workout started
 * for it, and a Watch walk for its treadmill block. Here each Health workout
 * gets at most one session:
 *
 * - **Pulso's own copies** (its bundle id, or the session id in their
 *   `HKMetadataKeyExternalUUID`) are the session itself: never shown, never counted.
 * - **The person's say** (`workout_links`) wins: joined to a session, or kept apart.
 * - **By time:** a workout with at least half of its length inside a session's
 *   [start − 10 min, end + 10 min] is part of it (the most-overlapped session if two).
 *
 * Everything else stays a workout on its own. Read-time only: nothing is
 * rewritten, so "Separar" and later syncs simply change the answer.
 */
import type { ActivityEntry, CardioLog, HeartRatePoint, JoinCandidate, RecordedPart, SessionRecording, TrainingSession, Workout } from "@pulso/contract";
import { db } from "./db";
import { getSession, listSessions } from "./training/store";
import { heartRates, listWorkouts, workoutsBetween, workoutsByIds } from "./workouts";
import { PULSO_BUNDLE } from "./workouts-dedupe";

export const SLACK_MS = 10 * 60_000;
/** How far around a session "Unir con…" looks. */
const NEARBY_MS = 3 * 3600_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const ACTIVITY_ES: Record<string, string> = {
  running: "Carrera",
  walking: "Caminata",
  hiking: "Senderismo",
  cycling: "Ciclismo",
  swimming: "Natación",
  strength: "Fuerza",
  functional_strength: "Fuerza funcional",
  hiit: "HIIT",
  yoga: "Yoga",
  rowing: "Remo",
  elliptical: "Elíptica",
  core: "Core",
  flexibility: "Flexibilidad",
  cross_training: "Entrenamiento cruzado",
  soccer: "Fútbol",
  stair_climbing: "Escaladora",
  stairs: "Escaleras",
  mixed_cardio: "Cardio",
  jump_rope: "Comba",
  cooldown: "Enfriamiento",
};

export const activityLabel = (activity: string) => ACTIVITY_ES[activity] ?? "Entrenamiento";

/** Cardio a session's cardio block can be. Raw HealthKit numbers are what older phones sent for unnamed types. */
const CARDIO = new Set([
  "running", "walking", "hiking", "cycling", "elliptical", "rowing", "stair_climbing", "stairs", "hiit", "mixed_cardio", "jump_rope", "swimming", "cross_training",
  "other_30", "other_44", "other_64", "other_68", "other_69", "other_73",
]);
export const isCardio = (activity: string) => CARDIO.has(activity);

export const isPulsoWritten = (w: Pick<Workout, "sourceBundle" | "externalRef">, sessionIds: Set<string>) =>
  (w.sourceBundle != null && PULSO_BUNDLE.test(w.sourceBundle)) || (w.externalRef != null && refSession(w.externalRef, sessionIds) !== null);

/** "<sessionId>" or "<sessionId>-<n>" → the session it names, when known. A session id may itself end in "-<digits>", so the whole ref is tried first. */
function refSession(ref: string, sessionIds: Set<string>): string | null {
  if (sessionIds.has(ref)) return ref;
  const base = ref.replace(/-\d+$/, "");
  return base !== ref && sessionIds.has(base) ? base : null;
}

export type Span = { id: string; startedAt: number; endedAt: number };

export type Attachments = {
  /** session id → its workouts (Pulso's own copies excluded), oldest first */
  bySession: Map<string, { workout: Workout; link: RecordedPart["link"] }[]>;
  /** workout id → the session it is part of */
  sessionOf: Map<string, string>;
  /** Pulso's own copies of its sessions */
  hidden: Set<string>;
};

/** Length of [a, b) ∩ [c, d). */
const shared = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/**
 * The rules above, pure. `manual` is `workout_links`: workout id → session id,
 * or null for "kept apart".
 */
export function attach(sessions: Span[], workouts: Workout[], manual: Map<string, string | null>): Attachments {
  const ids = new Set(sessions.map((s) => s.id));
  const bySession: Attachments["bySession"] = new Map();
  const sessionOf = new Map<string, string>();
  const hidden = new Set<string>();
  const add = (sessionId: string, workout: Workout, link: RecordedPart["link"]) => {
    bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), { workout, link }]);
    sessionOf.set(workout.id, sessionId);
  };
  for (const w of [...workouts].sort((a, b) => a.startedAt - b.startedAt)) {
    if (isPulsoWritten(w, ids)) {
      hidden.add(w.id);
      const own = w.externalRef ? refSession(w.externalRef, ids) : null;
      const sessionId = own ?? bestOverlap(sessions, w)?.id;
      if (sessionId) sessionOf.set(w.id, sessionId);
      continue;
    }
    if (manual.has(w.id)) {
      const sessionId = manual.get(w.id);
      if (sessionId && ids.has(sessionId)) add(sessionId, w, "manual");
      continue;
    }
    const length = w.endedAt - w.startedAt;
    const best = bestOverlap(sessions, w);
    if (best && length > 0 && shared(w.startedAt, w.endedAt, best.startedAt - SLACK_MS, best.endedAt + SLACK_MS) * 2 >= length) add(best.id, w, "overlap");
  }
  return { bySession, sessionOf, hidden };
}

function bestOverlap(sessions: Span[], w: Workout): Span | undefined {
  let best: Span | undefined;
  let most = 0;
  for (const s of sessions) {
    const overlap = shared(w.startedAt, w.endedAt, s.startedAt - SLACK_MS, s.endedAt + SLACK_MS);
    if (overlap > most) [best, most] = [s, overlap];
  }
  return best;
}

export function part(w: Workout, link: RecordedPart["link"]): RecordedPart {
  return {
    workoutId: w.id,
    activity: w.activity,
    title: activityLabel(w.activity),
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    energy: w.energy,
    distance: w.distance != null && w.distance > 0 ? w.distance : null,
    avgHeartRate: w.avgHeartRate ?? null,
    maxHeartRate: w.maxHeartRate ?? null,
    sourceName: w.sourceName,
    cardio: isCardio(w.activity),
    link,
  };
}

const sumOrNull = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

/** What the parts add to `session`: union of times, kcal and distance summed once, heart rate weighted by length. */
export function recording(session: Span, parts: RecordedPart[], series: HeartRatePoint[] = []): SessionRecording {
  const withHr = parts.filter((p) => p.avgHeartRate != null && p.endedAt > p.startedAt);
  const hrWeight = withHr.reduce((n, p) => n + (p.endedAt - p.startedAt), 0);
  const maxes = parts.map((p) => p.maxHeartRate).filter((v): v is number => v != null);
  return {
    parts,
    startedAt: Math.min(session.startedAt, ...parts.map((p) => p.startedAt)),
    endedAt: Math.max(session.endedAt, ...parts.map((p) => p.endedAt)),
    energy: sumOrNull(parts.map((p) => p.energy)),
    distance: sumOrNull(parts.filter((p) => p.cardio).map((p) => p.distance)),
    avgHeartRate: hrWeight > 0 ? Math.round(withHr.reduce((n, p) => n + p.avgHeartRate! * (p.endedAt - p.startedAt), 0) / hrWeight) : null,
    maxHeartRate: maxes.length ? Math.max(...maxes) : null,
    heartRate: series,
  };
}

/**
 * Each cardio part fills the cardio block it was recorded for: the block its
 * time overlaps most, else the remaining blocks in order. Only what the log
 * left empty is filled; nothing the person typed is replaced.
 */
export function fillCardio(cardio: CardioLog[], parts: RecordedPart[]): CardioLog[] {
  const pool = parts.filter((p) => p.cardio);
  const matched = new Map<number, RecordedPart>();
  const window = (c: CardioLog) => [c.doneAt - c.durationSeconds * 1000, c.doneAt] as const;
  cardio.forEach((c, i) => {
    const [start, end] = window(c);
    let best: RecordedPart | undefined;
    let most = 0;
    for (const p of pool) {
      const overlap = shared(p.startedAt, p.endedAt, start - SLACK_MS, end + SLACK_MS);
      if (overlap > most) [best, most] = [p, overlap];
    }
    if (best) {
      matched.set(i, best);
      pool.splice(pool.indexOf(best), 1);
    }
  });
  cardio.forEach((_, i) => {
    if (!matched.has(i) && pool.length) matched.set(i, pool.shift()!);
  });
  return cardio.map((c, i) => {
    const p = matched.get(i);
    if (!p) return c;
    return {
      ...c,
      durationSeconds: c.durationSeconds > 0 ? c.durationSeconds : Math.round((p.endedAt - p.startedAt) / 1000),
      distanceKm: c.distanceKm ?? (p.distance != null ? Math.round(p.distance) / 1000 : null),
      kcal: c.kcal ?? (p.energy != null ? Math.round(p.energy) : null),
      avgHr: c.avgHr ?? p.avgHeartRate,
      recordedBy: p.workoutId,
    };
  });
}

// ── Reading it from the database ─────────────────────────────────────────────

const manualLinks = () =>
  new Map(db().query<{ workout_id: string; session_id: string | null }, []>("SELECT workout_id, session_id FROM workout_links").all().map((r) => [r.workout_id, r.session_id]));

const spansBetween = (from: number, to: number): Span[] =>
  db()
    .query<{ id: string; started_at: number; ended_at: number }, [number, number]>("SELECT id, started_at, ended_at FROM training_sessions WHERE ended_at >= ? AND started_at < ?")
    .all(from, to)
    .map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at }));

const spansByIds = (ids: string[]): Span[] =>
  ids.length === 0
    ? []
    : db()
        .query<{ id: string; started_at: number; ended_at: number }, string[]>(`SELECT id, started_at, ended_at FROM training_sessions WHERE id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids)
        .map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at }));

/**
 * Attachments for everything overlapping [from, to): the sessions and workouts
 * there, padded so a workout at the edge still finds its session, plus
 * whatever the person linked across the edge.
 */
export function attachmentsBetween(from: number, to: number): Attachments & { sessions: Span[]; workouts: Workout[] } {
  const manual = manualLinks();
  const sessions = spansBetween(from - HOUR, to + HOUR);
  const workouts = workoutsBetween(from - HOUR, to + HOUR);
  const known = new Set(sessions.map((s) => s.id));
  const linked = workouts.map((w) => manual.get(w.id)).filter((id): id is string => !!id && !known.has(id));
  sessions.push(...spansByIds([...new Set(linked)]));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const seen = new Set(workouts.map((w) => w.id));
  const pulledIn = [...manual].filter(([w, s]) => s && sessionIds.has(s) && !seen.has(w)).map(([w]) => w);
  workouts.push(...workoutsByIds(pulledIn));
  return { ...attach(sessions, workouts, manual), sessions, workouts };
}

/** `sessions` with what Health recorded during each merged in. `series` adds heart rate (one session's detail). */
export function mergeSessions(sessions: TrainingSession[], options: { series?: boolean } = {}): TrainingSession[] {
  if (sessions.length === 0) return sessions;
  const from = Math.min(...sessions.map((s) => s.startedAt));
  const to = Math.max(...sessions.map((s) => s.endedAt));
  const { bySession } = attachmentsBetween(from - SLACK_MS, to + SLACK_MS);
  const ids = options.series ? sessions.flatMap((s) => (bySession.get(s.id) ?? []).map((a) => a.workout.id)) : [];
  const hr = heartRates(ids);
  return sessions.map((s) => {
    const attached = bySession.get(s.id) ?? [];
    if (attached.length === 0) return { ...s, merged: false, recorded: null };
    const parts = attached.map((a) => part(a.workout, a.link));
    const series = parts.flatMap((p) => hr.get(p.workoutId) ?? []).sort((a, b) => a.at - b.at);
    const cardio = fillCardio(s.cardio, parts);
    return {
      ...s,
      cardio,
      cardioMinutes: Math.round(cardio.reduce((n, c) => n + c.durationSeconds, 0) / 6) / 10,
      merged: true,
      recorded: recording(s, parts, series),
    };
  });
}

/** Newest first, like `listSessions`, each merged. */
export function listMergedSessions(limit = 20, exerciseId?: string): TrainingSession[] {
  return mergeSessions(listSessions(limit, exerciseId));
}

/** One session's detail: merged, with its heart rate and the Health workouts nearby it could be joined with. */
export function mergedSessionDetail(id: string): TrainingSession | undefined {
  const session = getSession(id);
  if (!session) return undefined;
  const merged = mergeSessions([session], { series: true })[0]!;
  return { ...merged, joinable: joinableFor([session]).get(id) ?? [] };
}

/** Per session, the Health workouts within three hours of it that are not part of it ("Unir con…"). One read for all. */
export function joinableFor(sessions: Span[]): Map<string, JoinCandidate[]> {
  const out = new Map<string, JoinCandidate[]>();
  if (sessions.length === 0) return out;
  const near = attachmentsBetween(Math.min(...sessions.map((s) => s.startedAt)) - NEARBY_MS, Math.max(...sessions.map((s) => s.endedAt)) + NEARBY_MS);
  for (const s of sessions) {
    const list = near.workouts
      .filter((w) => !near.hidden.has(w.id) && near.sessionOf.get(w.id) !== s.id)
      .filter((w) => w.endedAt >= s.startedAt - NEARBY_MS && w.startedAt < s.endedAt + NEARBY_MS)
      .map((w): JoinCandidate => {
        const { link: _, ...rest } = part(w, "manual");
        return { ...rest, joinedTo: near.sessionOf.get(w.id) ?? null };
      });
    out.set(s.id, list);
  }
  return out;
}

/**
 * Health workouts that are not part of any Pulso session, newest first.
 * Reads back in pages until it has `limit` of them.
 */
export function standaloneWorkouts(limit = 50): Workout[] {
  const out: Workout[] = [];
  let before = Number.MAX_SAFE_INTEGER;
  for (let page = 0; page < 20 && out.length < limit; page++) {
    const batch = listWorkouts(Math.max(limit * 2, 20), before);
    if (batch.length === 0) break;
    const from = batch.at(-1)!.startedAt;
    const to = Math.max(...batch.map((w) => w.endedAt));
    const { sessionOf, hidden } = attachmentsBetween(from, to);
    out.push(...batch.filter((w) => !sessionOf.has(w.id) && !hidden.has(w.id)));
    before = from;
  }
  return out.slice(0, limit);
}

/** Pulso sessions (merged) and Health workouts on their own, newest first: each workout once. */
export function recentActivity(limit = 20): ActivityEntry[] {
  const sessions = listMergedSessions(limit).map(sessionEntry);
  const workouts = standaloneWorkouts(limit).map(workoutEntry);
  return [...sessions, ...workouts].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export function sessionEntry(s: TrainingSession): ActivityEntry {
  const r = s.recorded ?? null;
  const loggedKm = sumOrNull(s.cardio.map((c) => c.distanceKm));
  return {
    kind: "session",
    id: s.id,
    title: s.name,
    activity: null,
    startedAt: r?.startedAt ?? s.startedAt,
    endedAt: r?.endedAt ?? s.endedAt,
    energy: r?.energy ?? sumOrNull(s.cardio.map((c) => c.kcal)),
    distance: r?.distance ?? (loggedKm ? loggedKm * 1000 : null),
    avgHeartRate: r?.avgHeartRate ?? null,
    maxHeartRate: r?.maxHeartRate ?? null,
    sets: s.sets.length,
    volumeKg: Math.round(s.sets.reduce((n, set) => n + set.weightKg * set.reps, 0)),
    merged: !!s.merged,
    parts: r?.parts ?? [],
    sourceName: "Pulso",
  };
}

export function workoutEntry(w: Workout): ActivityEntry {
  return {
    kind: "workout",
    id: w.id,
    title: activityLabel(w.activity),
    activity: w.activity,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    energy: w.energy,
    distance: w.distance != null && w.distance > 0 ? w.distance : null,
    avgHeartRate: w.avgHeartRate ?? null,
    maxHeartRate: w.maxHeartRate ?? null,
    sets: null,
    volumeKg: null,
    merged: false,
    parts: [],
    sourceName: w.sourceName,
  };
}

// ── "Separar" / "Unir con…" ──────────────────────────────────────────────────

export class LinkError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_request",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Joins a workout to `sessionId`, or keeps it apart with null. Returns the
 * session it is now in, or the one it left. Pulso's own copies can't be moved.
 */
export function linkWorkout(workoutId: string, sessionId: string | null, now = Date.now()): TrainingSession | null {
  const workout = workoutsByIds([workoutId])[0];
  if (!workout) throw new LinkError("not_found", "no such workout");
  if (sessionId !== null && !getSession(sessionId)) throw new LinkError("not_found", "no such session");
  const before = currentSession(workout);
  if (before.hidden || isPulsoWritten(workout, new Set())) throw new LinkError("invalid_request", "this workout is Pulso's own copy of a session");
  db().run(
    "INSERT INTO workout_links (workout_id, session_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (workout_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at",
    [workoutId, sessionId, now],
  );
  const shown = sessionId ?? before.sessionId;
  return shown ? (mergedSessionDetail(shown) ?? null) : null;
}

/** Drops the person's say: matching by time decides again. Returns the session it ends up in, or the one it left. */
export function unlinkWorkout(workoutId: string): TrainingSession | null {
  const workout = workoutsByIds([workoutId])[0];
  if (!workout) throw new LinkError("not_found", "no such workout");
  const before = currentSession(workout).sessionId;
  db().run("DELETE FROM workout_links WHERE workout_id = ?", [workoutId]);
  const after = currentSession(workout).sessionId ?? before;
  return after ? (mergedSessionDetail(after) ?? null) : null;
}

function currentSession(w: Workout): { sessionId: string | null; hidden: boolean } {
  const a = attachmentsBetween(w.startedAt - DAY, w.endedAt + DAY);
  return { sessionId: a.sessionOf.get(w.id) ?? null, hidden: a.hidden.has(w.id) };
}
