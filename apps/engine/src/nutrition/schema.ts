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
  -- Zones the Coach or the person set by hand; nutrients without a row get one derived from the target.
  CREATE TABLE IF NOT EXISTS nutrition_target_zones (
    nutrient TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    min REAL,
    max REAL
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
  -- The dated plan (see DIET.md). A plan_days row marks a date as materialized from the
  -- rotation, so a date whose slots were all moved away is never refilled; it also holds
  -- the kcal shifted onto that day when a deviation is spread.
  CREATE TABLE IF NOT EXISTS plan_days (
    plan_id TEXT NOT NULL,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    shift_kcal REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, date)
  );
  CREATE TABLE IF NOT EXISTS plan_horizons (
    plan_id TEXT PRIMARY KEY,
    days INTEGER NOT NULL
  );
  -- status is planned, skipped or replaced; eaten is derived from meal_slot_links.
  CREATE TABLE IF NOT EXISTS plan_slots (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT,
    recipe_id TEXT,
    prep_id TEXT,
    portions REAL,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    note TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plan_slots_date ON plan_slots (plan_id, date, position);
  CREATE INDEX IF NOT EXISTS plan_slots_prep ON plan_slots (prep_id);
  CREATE TABLE IF NOT EXISTS meal_slot_links (
    entry_id TEXT PRIMARY KEY REFERENCES meal_entries (id) ON DELETE CASCADE,
    slot_id TEXT NOT NULL,
    role TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meal_slot_links_slot ON meal_slot_links (slot_id);
  -- Entries the person or the Coach said are extras ("eso fue un snack"): reconciling never ties them to a meal.
  CREATE TABLE IF NOT EXISTS meal_entry_pins (
    entry_id TEXT PRIMARY KEY REFERENCES meal_entries (id) ON DELETE CASCADE,
    pin TEXT NOT NULL
  );
  -- One-off data repairs that already ran (e.g. tying meals logged before reconciling existed).
  CREATE TABLE IF NOT EXISTS nutrition_repairs (
    name TEXT PRIMARY KEY,
    ran_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    servings REAL NOT NULL,
    prep_minutes INTEGER NOT NULL,
    batch INTEGER NOT NULL DEFAULT 0,
    ingredients_json TEXT NOT NULL,
    steps TEXT,
    variant_of TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prep_batches (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    recipe_id TEXT NOT NULL,
    cook_date TEXT NOT NULL,
    portions REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    cooked_at INTEGER,
    created_at INTEGER NOT NULL
  );
  -- before_json holds the touched rows as they were, so undo can put them back.
  CREATE TABLE IF NOT EXISTS plan_revisions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    op TEXT NOT NULL,
    summary TEXT NOT NULL,
    dates_json TEXT NOT NULL,
    prep_ids_json TEXT NOT NULL,
    before_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    undone_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS plan_revisions_plan ON plan_revisions (plan_id, created_at);
  -- Dishes eaten (platillos): entries with a meal_dish_components row are the dish's components.
  -- Entries without one are single foods, as before.
  CREATE TABLE IF NOT EXISTS meal_dishes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    saved_dish_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meal_dish_components (
    entry_id TEXT PRIMARY KEY REFERENCES meal_entries (id) ON DELETE CASCADE,
    dish_id TEXT NOT NULL REFERENCES meal_dishes (id) ON DELETE CASCADE,
    position INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meal_dish_components_dish ON meal_dish_components (dish_id);
  -- Mis platillos: reusable dishes; components_json holds one default portion.
  CREATE TABLE IF NOT EXISTS saved_dishes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slot TEXT,
    components_json TEXT NOT NULL,
    recipe_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
