/**
 * One shopping list: its items, and a single row saying which plan and range
 * the plan items came from. `key` (ingredient + unit) matches plan items across
 * regenerations; manual items have none.
 */
export const SHOPPING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS shopping_items (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT NOT NULL,
    amount TEXT,
    quantity REAL,
    unit TEXT,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0,
    pantry INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    plan_id TEXT,
    plan_name TEXT,
    from_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    generated_at INTEGER NOT NULL
  );
  -- The retired pantry (what was at home). Kept so no data is lost; nothing reads or writes it.
  CREATE TABLE IF NOT EXISTS pantry_items (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    shopping_item_id TEXT UNIQUE REFERENCES shopping_items (id) ON DELETE SET NULL,
    bought_on TEXT,
    expires_on TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pantry_items_key ON pantry_items (key);
`;
