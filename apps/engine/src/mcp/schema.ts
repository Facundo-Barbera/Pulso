import type { Database } from "bun:sqlite";

/** External MCP clients (each with its own secret and scope) and what they called. */
export const MCP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mcp_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('read', 'read+write')),
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS mcp_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES mcp_clients (id),
    tool TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'refused')),
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mcp_audit_at ON mcp_audit (at DESC);
`;

/** `sensitive` (the Sustancias grant) came later; SQLite has no `ADD COLUMN IF NOT EXISTS`, so it is checked first. */
export function migrateMcp(database: Database): void {
  const existing = database.query<{ name: string }, []>("PRAGMA table_info(mcp_clients)").all();
  if (!existing.some((c) => c.name === "sensitive")) database.exec("ALTER TABLE mcp_clients ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0");
}
