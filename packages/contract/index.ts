import type { DeviceKind } from "./web";

/** Engine port on loopback. Not 3000 (Telar) nor 3210 (Delta). */
export const ENGINE_PORT = 3230;
/** Tailnet proxy port. Not 8088 (Delta). */
export const TAILNET_PORT = 8090;

/** Header the tailnet proxy stamps on every forwarded request. */
export const VIA_HEADER = "x-pulso-via";
/** The Host the browser wrote, passed on by the tailnet proxy (it rewrites `Host`); cookie writes check Origin against it. */
export const HOST_HEADER = "x-pulso-host";

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
  /** HealthKit source app, e.g. `com.apple.health.<uuid>` for the Watch or a gym app's bundle id. */
  sourceBundle: string | null;
  /** Display name of that source, e.g. "Apple Watch de Facundo". */
  sourceName: string | null;
};

/**
 * What the phone sends from HealthKit. Apple Health often holds one session
 * twice (two apps); the engine returns only the canonical one, so clients
 * never need to merge.
 */
export type WorkoutInput = Omit<Workout, "id" | "source" | "sourceBundle" | "sourceName"> & {
  externalId: string;
  sourceBundle?: string | null;
  sourceName?: string | null;
};

export type PairRequest = { code: string; name: string };
export type PairResponse = { deviceId: string; name: string; token: string };
export type PairCode = { code: string; expiresAt: number; kind: DeviceKind; address: string | null };

export type ApiError = { code: string; message: string };

export * from "./agent";
export * from "./web";
export * from "./nutrition";
export * from "./training";
export * from "./body";
export * from "./daily";
export * from "./sleep";
export * from "./medication";
export * from "./coach";
