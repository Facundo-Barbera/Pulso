/** Meal log (with measures as said, caffeine and alcohol), daily targets (single row), diet plans and their day adjustments, water, and the Open Food Facts cache. */
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
  -- A side table rather than new meal_entries columns, so the schema stays CREATE-only.
  CREATE TABLE IF NOT EXISTS meal_entry_context (
    entry_id TEXT PRIMARY KEY REFERENCES meal_entries (id) ON DELETE CASCADE,
    off_plan INTEGER NOT NULL DEFAULT 0,
    note TEXT
  );
  -- The amount as the person said it ("2 latas"; meal_entries keeps the normalized g/ml/serving)
  -- and caffeine/alcohol. Entries without a row are plain g/serving logs, as before.
  CREATE TABLE IF NOT EXISTS meal_entry_detail (
    entry_id TEXT PRIMARY KEY REFERENCES meal_entries (id) ON DELETE CASCADE,
    measure_amount REAL,
    measure_unit TEXT,
    measure_size REAL,
    caffeine_mg REAL,
    alcohol_g REAL
  );
  CREATE TABLE IF NOT EXISTS plan_adjustments (
    date TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    adjustment_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS water_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    logged_at INTEGER NOT NULL,
    amount_ml REAL NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS water_entries_date ON water_entries (date, logged_at);
  CREATE TABLE IF NOT EXISTS water_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    goal_ml REAL,
    unit TEXT NOT NULL,
    glass_ml REAL NOT NULL,
    bottle_ml REAL NOT NULL
  );
`;
