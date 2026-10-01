/** Engine port on loopback. Not 3000 (Telar) nor 3210 (Delta). */
export const ENGINE_PORT = 3230;
/** Tailnet proxy port. Not 8088 (Delta). */
export const TAILNET_PORT = 8090;

/** Header the tailnet proxy stamps on every forwarded request. */
export const VIA_HEADER = "x-pulso-via";

/** A workout as stored by the engine. `source` says where it came from. */
export type Workout = {
  id: string;
  /** HealthKit UUID when synced from the phone; dedupes re-syncs. */
  externalId: string | null;
  source: "healthkit" | "manual";
  activity: string;
  startedAt: number;
  endedAt: number;
  /** kcal */
  energy: number | null;
  /** meters */
  distance: number | null;
};

/** What the phone sends from HealthKit. */
export type WorkoutInput = Omit<Workout, "id" | "source"> & { externalId: string };

export type PairRequest = { code: string; name: string };
export type PairResponse = { deviceId: string; name: string; token: string };
export type PairCode = { code: string; expiresAt: number; address: string | null };

export type ApiError = { code: string; message: string };

export * from "./agent";
export * from "./nutrition";
export * from "./training";
export * from "./body";
export * from "./daily";
export * from "./sleep";
export * from "./medication";
