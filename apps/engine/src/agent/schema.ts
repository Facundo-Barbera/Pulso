/** Coach threads, their messages with photos and scanned products, and the person's profile (one row). */
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
  CREATE TABLE IF NOT EXISTS agent_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
