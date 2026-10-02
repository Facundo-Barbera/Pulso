// ── Health workouts merged into Pulso sessions ───────────────────────────────
//
// One workout is often in Salud three times: the Pulso session, the Watch's
// strength workout started for it, and the Watch walk of its treadmill block.
// The engine attaches such Health workouts to the session they belong to, so
// every list and total sees the session once.

/** One heart-rate reading. `at` epoch ms. */
export type HeartRatePoint = { at: number; bpm: number };

/** A Health workout recorded during a Pulso session (the Watch's "Fuerza", the treadmill walk). */
export type RecordedPart = {
  workoutId: string;
  /** Health activity, e.g. "strength", "walking" */
  activity: string;
  /** Spanish, e.g. "Fuerza", "Caminata" */
  title: string;
  startedAt: number;
  endedAt: number;
  /** kcal */
  energy: number | null;
  /** meters */
  distance: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  /** The app that recorded it, e.g. "Apple Watch de Facundo". */
  sourceName: string | null;
  /** walking, running, cycling, elliptical, rowing, stairs, HIIT… */
  cardio: boolean;
  /** "overlap": matched by time; "manual": the person joined it ("Unir con…"). */
  link: "overlap" | "manual";
};

/** What Health recorded during a session, merged in. */
export type SessionRecording = {
  parts: RecordedPart[];
  /** Union of the session and its parts: what the row's duration shows. */
  startedAt: number;
  endedAt: number;
  /** kcal: the distinct parts summed, never Pulso's estimates on top. Null without any. */
  energy: number | null;
  /** meters, from the cardio parts */
  distance: number | null;
  /** bpm, weighted by each part's length */
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  /** The parts' heart rate, oldest first; empty when Health had none. */
  heartRate: HeartRatePoint[];
};

/** A Health workout near a session that the person may join to it ("Unir con…"). */
export type JoinCandidate = Omit<RecordedPart, "link"> & {
  /** The session it is part of now, when it is part of another one. */
  joinedTo: string | null;
};

/** `PUT /api/mobile/workouts/<id>/link`: join to `sessionId`, or keep apart with null ("Separar"). `DELETE` goes back to automatic. */
export type WorkoutLinkInput = { sessionId: string | null };

/**
 * One row of "what I trained": a Pulso session, with whatever Health recorded
 * during it merged in, or a Health workout on its own. Lists and totals built
 * from these count each workout once.
 */
export type ActivityEntry = {
  kind: "session" | "workout";
  /** The session's or the workout's id. */
  id: string;
  /** Spanish: the session's name ("Torso A") or the activity ("Carrera"). */
  title: string;
  /** Health activity for workouts; null for sessions. */
  activity: string | null;
  startedAt: number;
  endedAt: number;
  /** kcal */
  energy: number | null;
  /** meters */
  distance: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  /** Sessions: sets done and their volume (kg × reps). */
  sets: number | null;
  volumeKg: number | null;
  /** true when Health workouts were merged into this session. */
  merged: boolean;
  parts: RecordedPart[];
  /** Workouts: the app that recorded it. */
  sourceName: string | null;
};
