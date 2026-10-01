import type { SleepNight, SleepOverview, SleepSegmentInput, SleepSourceKind, SleepStage, SleepSummary } from "@pulso/contract";
import { db } from "../db";
import { buildNights, DEFAULT_TARGET_MIN, describeNights, HISTORY_NIGHTS, nightOf, type StoredSegment, summarize } from "./metrics";

type Row = { night: string; source: string; source_kind: SleepSourceKind; start: number; end: number; stage: SleepStage; tz_offset_min: number };

const STAGES = new Set<SleepStage>(["inBed", "awake", "core", "deep", "rem", "asleep"]);
const KINDS = new Set<SleepSourceKind>(["watch", "phone", "other"]);

export function sleepTargetMin(): number {
  const row = db().query<{ value: string }, []>("SELECT value FROM sleep_settings WHERE key = 'target_min'").get();
  return row ? Number(row.value) : DEFAULT_TARGET_MIN;
}

export function setSleepTargetMin(min: number): number {
  const value = Math.round(min);
  db().query("INSERT INTO sleep_settings (key, value) VALUES ('target_min', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(value));
  return value;
}

/**
 * Upserts by night and source: every (night, source) present in the batch
 * replaces what was stored for it, so re-syncing the same 60 nights is
 * harmless. Returns the nights touched.
 */
export function upsertSleepSegments(inputs: SleepSegmentInput[]): string[] {
  const groups = new Map<string, StoredSegment[]>();
  for (const s of inputs) {
    const night = nightOf(s.start, s.tzOffsetMin);
    const key = JSON.stringify([night, s.source]);
    groups.set(key, [...(groups.get(key) ?? []), { ...s, night }]);
  }
  const remove = db().query("DELETE FROM sleep_segments WHERE night = ? AND source = ?");
  const insert = db().query(
    "INSERT INTO sleep_segments (night, source, source_kind, start, end, stage, tz_offset_min) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db().transaction(() => {
    for (const [key, segs] of groups) {
      const [night, source] = JSON.parse(key) as [string, string];
      remove.run(night, source);
      for (const s of segs) insert.run(night, source, s.sourceKind, s.start, s.end, s.stage, s.tzOffsetMin);
    }
  })();
  return [...new Set([...groups.keys()].map((k) => (JSON.parse(k) as [string])[0]))].sort();
}

/** Nights in [from, to] (YYYY-MM-DD, inclusive), newest first, each scored against the 14 nights before it. */
export function listSleepNights(from: string, to: string): SleepNight[] {
  const historyFrom = new Date(Date.parse(`${from}T00:00:00Z`) - HISTORY_NIGHTS * 86_400_000).toISOString().slice(0, 10);
  const rows = db()
    .query<Row, [string, string]>("SELECT * FROM sleep_segments WHERE night >= ? AND night <= ? ORDER BY start")
    .all(historyFrom, to);
  const segments: StoredSegment[] = rows.map((r) => ({
    night: r.night,
    source: r.source,
    sourceKind: r.source_kind,
    start: r.start,
    end: r.end,
    stage: r.stage,
    tzOffsetMin: r.tz_offset_min,
  }));
  return describeNights(buildNights(segments), sleepTargetMin()).filter((n) => n.night >= from);
}

export function latestNight(): string | null {
  return db().query<{ night: string | null }, []>("SELECT MAX(night) AS night FROM sleep_segments").get()?.night ?? null;
}

const daysBefore = (night: string, days: number) => new Date(Date.parse(`${night}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);

/** Summary over the `days` days ending at the newest night. */
export function sleepSummary(days = HISTORY_NIGHTS): SleepSummary {
  const latest = latestNight();
  const nights = latest ? listSleepNights(daysBefore(latest, days), latest) : [];
  return summarize(nights, sleepTargetMin(), days);
}

/** What the phone's sleep screen shows: the last `days` nights and the 14-night summary. */
export function sleepOverview(days = 60): SleepOverview {
  const latest = latestNight();
  const nights = latest ? listSleepNights(daysBefore(latest, days), latest) : [];
  const targetMin = sleepTargetMin();
  return { targetMin, nights, summary: summarize(nights, targetMin) };
}

/** Validates an untrusted body from the phone. Undefined when any item is malformed. */
export function parseSleepInputs(body: unknown): SleepSegmentInput[] | undefined {
  const items = (body as { segments?: unknown })?.segments;
  if (!Array.isArray(items) || items.length > 20_000) return undefined;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const parsed: SleepSegmentInput[] = [];
  for (const item of items as Record<string, unknown>[]) {
    if (!num(item?.start) || !num(item.end) || item.end < item.start || !num(item.tzOffsetMin) || Math.abs(item.tzOffsetMin) > 14 * 60) return undefined;
    if (!STAGES.has(item.stage as SleepStage) || !KINDS.has(item.sourceKind as SleepSourceKind) || typeof item.source !== "string") return undefined;
    parsed.push({
      start: item.start,
      end: item.end,
      stage: item.stage as SleepStage,
      source: item.source.slice(0, 128),
      sourceKind: item.sourceKind as SleepSourceKind,
      tzOffsetMin: Math.round(item.tzOffsetMin),
    });
  }
  return parsed;
}
