/** Briefs the Coach writes on its own: one row per kind and period, rewritten on regenerate. */
export const COACH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coach_briefs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    period TEXT NOT NULL,
    status TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (kind, period)
  );
  CREATE INDEX IF NOT EXISTS coach_briefs_latest ON coach_briefs (kind, period DESC);
`;
