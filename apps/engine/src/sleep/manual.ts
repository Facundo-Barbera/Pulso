/**
 * Nights the person logs by hand when the watch missed them. One per night,
 * dated like HealthKit's (`nightOf` the moment they fell asleep), so a measured
 * night for the same date is found by key. The rule: a measured night always
 * wins. A manual night can't be logged over one, and when one arrives later the
 * manual row stays but is hidden (`hidden`), so the result never depends on
 * the order things were written in.
 */
import type { ManualSleepInput, ManualSleepNight, ManualSleepPatch } from "@pulso/contract";
import { db } from "../db";
import { formatDuration, nightOf } from "./metrics";

export const MIN_MANUAL_MIN = 60;
export const MAX_MANUAL_MIN = 16 * 60;
/** A wake time a few minutes ahead of the clock is a rounded "now", not the future. */
const FUTURE_SLACK_MS = 5 * 60_000;
const NOTE_MAX = 280;

export class SleepError extends Error {
  constructor(
    public code: "invalid" | "not_found" | "measured" | "taken",
    message: string,
  ) {
    super(message);
  }
}

type Row = { id: string; night: string; start: number; end: number; tz_offset_min: number; note: string | null; created_at: number; updated_at: number; hidden: number };

/** Whether HealthKit holds actual sleep (not just in-bed) for `night`. */
const MEASURED = "EXISTS (SELECT 1 FROM sleep_segments s WHERE s.night = m.night AND s.stage IN ('core', 'deep', 'rem', 'asleep'))";
const SELECT = `SELECT m.*, ${MEASURED} AS hidden FROM sleep_manual m`;

const toNight = (r: Row): ManualSleepNight => ({
  id: r.id,
  night: r.night,
  start: r.start,
  end: r.end,
  tzOffsetMin: r.tz_offset_min,
  note: r.note,
  hidden: r.hidden === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function measuredNight(night: string): boolean {
  return !!db().query<{ x: number }, [string]>("SELECT 1 AS x FROM sleep_segments WHERE night = ? AND stage IN ('core', 'deep', 'rem', 'asleep') LIMIT 1").get(night);
}

/** Manual nights in [from, to] (YYYY-MM-DD, inclusive), oldest first, hidden ones included. */
export function listManualNights(from: string, to: string): ManualSleepNight[] {
  return db().query<Row, [string, string]>(`${SELECT} WHERE m.night >= ? AND m.night <= ? ORDER BY m.night`).all(from, to).map(toNight);
}

export function getManualNight(id: string): ManualSleepNight {
  const row = db().query<Row, [string]>(`${SELECT} WHERE m.id = ?`).get(id);
  if (!row) throw new SleepError("not_found", "Esa noche ya no existe.");
  return toNight(row);
}

export function manualNightOn(night: string): ManualSleepNight | undefined {
  const row = db().query<Row, [string]>(`${SELECT} WHERE m.night = ?`).get(night);
  return row ? toNight(row) : undefined;
}

/** Newest night with a manual entry, hidden or not (a hidden one has a measured night on the same date anyway). */
export function latestManualNight(): string | null {
  return db().query<{ night: string | null }, []>("SELECT MAX(night) AS night FROM sleep_manual").get()?.night ?? null;
}

const dayLabel = (night: string) => new Date(`${night}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

type Checked = { start: number; end: number; tzOffsetMin: number; note: string | null; night: string };

/** Validates times and works out the night; throws `SleepError` in Spanish, ready to show. */
function check(input: { start: number; end: number; tzOffsetMin?: number; note?: string | null }, now: number): Checked {
  const { start, end } = input;
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new SleepError("invalid", "Faltan la hora de dormir o la de despertar.");
  if (end <= start) throw new SleepError("invalid", "La hora de despertar tiene que ser después de la de dormir.");
  const minutes = (end - start) / 60_000;
  if (minutes < MIN_MANUAL_MIN || minutes > MAX_MANUAL_MIN) {
    throw new SleepError("invalid", `Una noche tiene que durar entre 1 y 16 horas (esta dura ${formatDuration(minutes)}).`);
  }
  if (end > now + FUTURE_SLACK_MS) throw new SleepError("invalid", "La hora de despertar todavía no llegó.");
  const tzOffsetMin = Math.round(input.tzOffsetMin ?? -new Date(start).getTimezoneOffset());
  if (!Number.isFinite(tzOffsetMin) || Math.abs(tzOffsetMin) > 14 * 60) throw new SleepError("invalid", "Zona horaria inválida.");
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) || null;
  return { start: Math.round(start), end: Math.round(end), tzOffsetMin, note, night: nightOf(start, tzOffsetMin) };
}

/** The night must be free: no measured night (it wins) and no other manual one (edit that instead). */
function claim(night: string, self?: string): void {
  if (measuredNight(night)) throw new SleepError("measured", `Salud ya tiene medida la noche del ${dayLabel(night)}; esa es la que cuenta.`);
  const other = manualNightOn(night);
  if (other && other.id !== self) throw new SleepError("taken", `Ya registraste a mano la noche del ${dayLabel(night)}: edítala en vez de crear otra.`);
}

export function addManualNight(input: ManualSleepInput, now = Date.now()): ManualSleepNight {
  const c = check(input, now);
  claim(c.night);
  const id = crypto.randomUUID();
  db()
    .query("INSERT INTO sleep_manual (id, night, start, end, tz_offset_min, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, c.night, c.start, c.end, c.tzOffsetMin, c.note, now, now);
  return getManualNight(id);
}

/** Changes times or note. Moving it onto a date Health measured, or one already logged, is refused. */
export function updateManualNight(id: string, patch: ManualSleepPatch, now = Date.now()): ManualSleepNight {
  const current = getManualNight(id);
  const c = check(
    {
      start: patch.start ?? current.start,
      end: patch.end ?? current.end,
      // New times without an offset take the Mac's; otherwise the night keeps its own.
      tzOffsetMin: patch.tzOffsetMin ?? (patch.start === undefined ? current.tzOffsetMin : undefined),
      note: patch.note === undefined ? current.note : patch.note,
    },
    now,
  );
  claim(c.night, id);
  db()
    .query("UPDATE sleep_manual SET night = ?, start = ?, end = ?, tz_offset_min = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(c.night, c.start, c.end, c.tzOffsetMin, c.note, now, id);
  return getManualNight(id);
}

/** Deletes it and returns what it was, so Deshacer can put it back. */
export function deleteManualNight(id: string): ManualSleepNight {
  const night = getManualNight(id);
  db().query("DELETE FROM sleep_manual WHERE id = ?").run(id);
  return night;
}

/** Puts a deleted night back as it was (undo). Refused if its date has been taken since. */
export function restoreManualNight(n: ManualSleepNight): ManualSleepNight {
  if (manualNightOn(n.night)) throw new SleepError("taken", "Esa noche ya está registrada otra vez.");
  db()
    .query("INSERT INTO sleep_manual (id, night, start, end, tz_offset_min, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(n.id, n.night, n.start, n.end, n.tzOffsetMin, n.note, n.createdAt, n.updatedAt);
  return getManualNight(n.id);
}

/** Validates an untrusted create body (the phone, the browser). Undefined when malformed. */
export function parseManualInput(body: unknown): ManualSleepInput | undefined {
  const b = body as Record<string, unknown> | undefined;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!num(b?.start) || !num(b.end)) return undefined;
  if (b.tzOffsetMin !== undefined && !num(b.tzOffsetMin)) return undefined;
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return undefined;
  return { start: b.start, end: b.end, tzOffsetMin: b.tzOffsetMin as number | undefined, note: b.note as string | null | undefined };
}

/** Validates an untrusted patch body. Undefined when malformed or empty. */
export function parseManualPatch(body: unknown): ManualSleepPatch | undefined {
  const b = body as Record<string, unknown> | undefined;
  if (!b || typeof b !== "object") return undefined;
  const num = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
  if (!num(b.start) || !num(b.end) || !num(b.tzOffsetMin)) return undefined;
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return undefined;
  const patch: ManualSleepPatch = {};
  if (b.start !== undefined) patch.start = b.start as number;
  if (b.end !== undefined) patch.end = b.end as number;
  if (b.tzOffsetMin !== undefined) patch.tzOffsetMin = b.tzOffsetMin as number;
  if (b.note !== undefined) patch.note = b.note as string | null;
  return Object.keys(patch).length ? patch : undefined;
}
