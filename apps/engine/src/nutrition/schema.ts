/** Meal log, daily targets (single row), diet plans and the Open Food Facts cache. */
export const NUTRITION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meal_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    eaten_at INTEGER NOT NULL,
    slot TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    fiber REAL NOT NULL,
    source TEXT NOT NULL,
    barcode TEXT,
    plan_item_id TEXT
  );
  CREATE INDEX IF NOT EXISTS meal_entries_date ON meal_entries (date, eaten_at);
  CREATE TABLE IF NOT EXISTS nutrition_targets (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    fiber REAL NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS diet_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT,
    starts_on TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    days_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS food_barcode_cache (
    barcode TEXT PRIMARY KEY,
    product_json TEXT,
    fetched_at INTEGER NOT NULL
  );
`;
