/** Raw HealthKit sleep samples, per night and source, and sleep settings (target). */
export const SLEEP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sleep_segments (
    night TEXT NOT NULL,
    source TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    stage TEXT NOT NULL,
    tz_offset_min INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sleep_segments_night ON sleep_segments (night, source);
  CREATE TABLE IF NOT EXISTS sleep_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;
