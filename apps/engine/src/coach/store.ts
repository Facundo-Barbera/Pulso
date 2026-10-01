import { randomUUID } from "node:crypto";
import type { CoachBrief, CoachBriefKind } from "@pulso/contract";
import { db } from "../db";

/** A `running` row this old belongs to a run that died: it may be claimed again. */
export const STALE_MS = 20 * 60_000;
/** How long the scheduler waits before retrying a period whose brief failed. */
export const RETRY_MS = 60 * 60_000;

type Row = { id: string; kind: CoachBriefKind; period: string; status: CoachBrief["status"]; text: string; error: string | null; created_at: number; updated_at: number };

const toBrief = (row: Row): CoachBrief => ({
  id: row.id,
  kind: row.kind,
  period: row.period,
  status: row.status,
  text: row.text,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function getBrief(id: string): CoachBrief | undefined {
  const row = db().query<Row, [string]>("SELECT * FROM coach_briefs WHERE id = ?").get(id);
  return row ? toBrief(row) : undefined;
}

export function briefFor(kind: CoachBriefKind, period: string): CoachBrief | undefined {
  const row = db().query<Row, [string, string]>("SELECT * FROM coach_briefs WHERE kind = ? AND period = ?").get(kind, period);
  return row ? toBrief(row) : undefined;
}

export function latestBrief(kind: CoachBriefKind): CoachBrief | null {
  const row = db().query<Row, [string]>("SELECT * FROM coach_briefs WHERE kind = ? ORDER BY period DESC LIMIT 1").get(kind);
  return row ? toBrief(row) : null;
}

/** Newest period first. */
export function listBriefs(kind?: CoachBriefKind, limit = 30): CoachBrief[] {
  const rows = kind
    ? db().query<Row, [string, number]>("SELECT * FROM coach_briefs WHERE kind = ? ORDER BY period DESC, updated_at DESC LIMIT ?").all(kind, limit)
    : db().query<Row, [number]>("SELECT * FROM coach_briefs ORDER BY period DESC, updated_at DESC LIMIT ?").all(limit);
  return rows.map(toBrief);
}

/**
 * Takes the right to write the brief for `kind` and `period`, atomically, so a
 * period is generated once even if two ticks (or two processes) race. Returns
 * the row now `running`, or undefined when someone else is on it, it is
 * already done (unless `force`), or it failed less than RETRY_MS ago.
 */
export function claimBrief(kind: CoachBriefKind, period: string, { force = false, now = Date.now() } = {}): CoachBrief | undefined {
  return db().transaction(() => {
    const existing = briefFor(kind, period);
    if (!existing) {
      const id = randomUUID();
      db().query("INSERT INTO coach_briefs (id, kind, period, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)").run(id, kind, period, now, now);
      return getBrief(id);
    }
    if (existing.status === "running" && now - existing.updatedAt < STALE_MS) return undefined;
    if (!force && existing.status === "done") return undefined;
    if (!force && existing.status === "error" && now - existing.updatedAt < RETRY_MS) return undefined;
    db().query("UPDATE coach_briefs SET status = 'running', error = NULL, updated_at = ? WHERE id = ?").run(now, existing.id);
    return getBrief(existing.id);
  }).immediate();
}

export function completeBrief(id: string, text: string, now = Date.now()): void {
  db().query("UPDATE coach_briefs SET status = 'done', text = ?, error = NULL, updated_at = ? WHERE id = ?").run(text, now, id);
}

/** A failed regenerate keeps the previous text and stays `done`; a first attempt becomes `error`. */
export function failBrief(id: string, error: string, now = Date.now()): void {
  db()
    .query("UPDATE coach_briefs SET status = CASE WHEN text <> '' THEN 'done' ELSE 'error' END, error = ?, updated_at = ? WHERE id = ?")
    .run(error, now, id);
}

/** A fresh process has no briefs being written: anything still `running` died with the last one. */
export function failRunningBriefs(reason: string): number {
  return db()
    .query("UPDATE coach_briefs SET status = CASE WHEN text <> '' THEN 'done' ELSE 'error' END, error = ? WHERE status = 'running'")
    .run(reason).changes;
}
