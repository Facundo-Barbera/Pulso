import type { Database } from "bun:sqlite";

/**
 * Coach threads, their messages with photos and scanned products, and the
 * person's profile (one row). The Coach screen is ONE perpetual conversation
 * (a thread named in agent_conversation) split into contexts, one SDK session
 * each; the other threads are the live-workout chats and the old conversations
 * from before it, kept but no longer shown.
 */
export const AGENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_threads_updated ON agent_threads (updated_at DESC);
  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    tools TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_messages_thread ON agent_messages (thread_id, created_at);
  -- Photos on a message; the JPEG lives at attachments/<thread_id>/<id>.jpg under the data dir.
  CREATE TABLE IF NOT EXISTS agent_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_attachments_message ON agent_attachments (message_id, position);
  -- Products scanned into a message: the code and the Open Food Facts product as it was then (NULL when unknown).
  CREATE TABLE IF NOT EXISTS agent_message_products (
    message_id TEXT NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    barcode TEXT NOT NULL,
    product_json TEXT,
    PRIMARY KEY (message_id, position)
  );
  -- The perpetual conversation (one row): its thread, the active context, and the one-time distillation of the old threads.
  CREATE TABLE IF NOT EXISTS agent_conversation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    thread_id TEXT NOT NULL REFERENCES agent_threads (id),
    active_context_id TEXT NOT NULL,
    distill_started_at INTEGER,
    distilled_at INTEGER
  );
  -- One SDK session each. seed: what the first session starts from (the distilled old threads); compacted_at: last summary, auto or hourly.
  CREATE TABLE IF NOT EXISTS agent_contexts (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
    sdk_session_id TEXT,
    seed TEXT,
    started_at INTEGER NOT NULL,
    compacted_at INTEGER,
    pruned_at INTEGER
  );
  -- Quiet lines in the feed: context, switch, compacted, distilled.
  CREATE TABLE IF NOT EXISTS agent_feed_markers (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
    context_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_feed_markers_thread ON agent_feed_markers (thread_id, created_at);
  CREATE TABLE IF NOT EXISTS agent_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

/**
 * Columns added after their table shipped: the context a conversation message
 * belongs to, where a quoted one came from, and how big a context was at its
 * last model call (NULL when unknown, e.g. right after a summary).
 */
const ADDED_COLUMNS: Record<string, string[]> = {
  agent_messages: ["context_id TEXT", "source TEXT"],
  agent_contexts: ["context_tokens INTEGER"],
};

export function migrateAgent(database: Database): void {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const column of columns) {
      if (!existing.has(column.split(" ")[0]!)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    }
  }
  database.exec("CREATE INDEX IF NOT EXISTS agent_messages_context ON agent_messages (context_id, created_at)");
}
