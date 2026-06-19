'use strict'

function columnExists(db, table, col) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((r) => r.name === col)
}

function tableExists(db, table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table)
}

function indexExists(db, name) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`).get(name)
}

// Ordered list of named, idempotent migrations.
// isApplied(db) → true if the migration has already taken effect (used to record pre-existing state
//                  on live databases without re-running the DDL).
// apply(db)     → runs the DDL. Called only when isApplied returns false.
const MIGRATIONS = [
  {
    name: 'scheduled_fixtures:home_team',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'home_team'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN home_team TEXT`)
  },
  {
    name: 'scheduled_fixtures:away_team',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'away_team'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN away_team TEXT`)
  },
  {
    name: 'scheduled_fixtures:ground',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'ground'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN ground TEXT`)
  },
  {
    name: 'scheduled_fixtures:ingest_token',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'ingest_token'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN ingest_token TEXT`)
  },
  {
    name: 'scheduled_fixtures:cron_job_id',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'cron_job_id'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN cron_job_id INTEGER`)
  },
  {
    name: 'wk_assignments:to_over',
    isApplied: (db) => columnExists(db, 'wk_assignments', 'to_over'),
    apply: (db) => db.exec(`ALTER TABLE wk_assignments ADD COLUMN to_over INTEGER`)
  },
  {
    name: 'fixtures:format',
    isApplied: (db) => columnExists(db, 'fixtures', 'format'),
    apply: (db) =>
      db.exec(`ALTER TABLE fixtures ADD COLUMN format TEXT NOT NULL DEFAULT 'standard'`)
  },
  {
    name: 'fixtures:starting_score',
    isApplied: (db) => columnExists(db, 'fixtures', 'starting_score'),
    apply: (db) =>
      db.exec(`ALTER TABLE fixtures ADD COLUMN starting_score INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'manual_batting:did_not_bat',
    isApplied: (db) => columnExists(db, 'manual_batting', 'did_not_bat'),
    apply: (db) =>
      db.exec(`ALTER TABLE manual_batting ADD COLUMN did_not_bat INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'manual_extras:bowling_byes',
    isApplied: (db) => columnExists(db, 'manual_extras', 'bowling_byes'),
    apply: (db) =>
      db.exec(`ALTER TABLE manual_extras ADD COLUMN bowling_byes INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'manual_extras:bowling_leg_byes',
    isApplied: (db) => columnExists(db, 'manual_extras', 'bowling_leg_byes'),
    apply: (db) =>
      db.exec(`ALTER TABLE manual_extras ADD COLUMN bowling_leg_byes INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'manual_extras:whcc_overs',
    isApplied: (db) => columnExists(db, 'manual_extras', 'whcc_overs'),
    apply: (db) => db.exec(`ALTER TABLE manual_extras ADD COLUMN whcc_overs TEXT`)
  },
  {
    name: 'manual_extras:opp_overs',
    isApplied: (db) => columnExists(db, 'manual_extras', 'opp_overs'),
    apply: (db) => db.exec(`ALTER TABLE manual_extras ADD COLUMN opp_overs TEXT`)
  },
  {
    name: 'manual_batting:times_out',
    isApplied: (db) => columnExists(db, 'manual_batting', 'times_out'),
    apply: (db) =>
      db.exec(`ALTER TABLE manual_batting ADD COLUMN times_out INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'players:display_name',
    isApplied: (db) => columnExists(db, 'players', 'display_name'),
    apply: (db) => db.exec(`ALTER TABLE players ADD COLUMN display_name TEXT`)
  },
  {
    name: 'players:is_sub',
    isApplied: (db) => columnExists(db, 'players', 'is_sub'),
    apply: (db) => db.exec(`ALTER TABLE players ADD COLUMN is_sub INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'players:ignore_flag',
    isApplied: (db) => columnExists(db, 'players', 'ignore_flag'),
    apply: (db) => db.exec(`ALTER TABLE players ADD COLUMN ignore_flag INTEGER NOT NULL DEFAULT 0`)
  },
  {
    name: 'fixtures:play_cricket_id',
    isApplied: (db) => columnExists(db, 'fixtures', 'play_cricket_id'),
    apply: (db) => db.exec(`ALTER TABLE fixtures ADD COLUMN play_cricket_id TEXT`)
  },
  {
    name: 'ingests:clerk_user_name',
    isApplied: (db) => columnExists(db, 'ingests', 'clerk_user_name'),
    apply: (db) => db.exec(`ALTER TABLE ingests ADD COLUMN clerk_user_name TEXT`)
  },
  {
    name: 'fixtures:max_overs',
    isApplied: (db) => columnExists(db, 'fixtures', 'max_overs'),
    apply: (db) => db.exec(`ALTER TABLE fixtures ADD COLUMN max_overs INTEGER NOT NULL DEFAULT 20`)
  },
  {
    name: 'scheduled_fixtures:notified_at',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'notified_at'),
    apply: (db) => db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN notified_at TEXT`)
  },
  {
    name: 'user_preferences:create',
    isApplied: (db) => tableExists(db, 'user_preferences'),
    apply: (db) =>
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          clerk_user_id TEXT NOT NULL PRIMARY KEY,
          player_list_columns TEXT NOT NULL DEFAULT '["MAT","INN","RUNS","AVG"]',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
  },
  {
    name: 'user_preferences:favourite_groups',
    isApplied: (db) => columnExists(db, 'user_preferences', 'favourite_groups'),
    apply: (db) =>
      db.exec(`ALTER TABLE user_preferences ADD COLUMN favourite_groups TEXT NOT NULL DEFAULT '[]'`)
  },
  {
    name: 'watched_teams:year',
    isApplied: (db) => columnExists(db, 'watched_teams', 'year'),
    apply: (db) => db.exec(`ALTER TABLE watched_teams ADD COLUMN year TEXT`)
  },
  {
    // mvp_cache.fixture_id was originally INTEGER; manual fixture ids aren't integers.
    // Drop and recreate if the column type is not TEXT.
    name: 'mvp_cache:fix-fixture-id-type',
    isApplied: (db) => {
      const col = db
        .prepare(`PRAGMA table_info(mvp_cache)`)
        .all()
        .find((c) => c.name === 'fixture_id')
      return !col || col.type.toUpperCase() === 'TEXT'
    },
    apply: (db) => {
      db.exec(`DROP TABLE mvp_cache`)
      db.exec(`
        CREATE TABLE mvp_cache (
          fixture_id   TEXT PRIMARY KEY,
          players_json TEXT NOT NULL,
          meta_json    TEXT NOT NULL,
          computed_at  INTEGER NOT NULL
        )
      `)
    }
  },
  {
    name: 'fixtures:match_date_iso',
    isApplied: (db) => columnExists(db, 'fixtures', 'match_date_iso'),
    apply: (db) => db.exec(`ALTER TABLE fixtures ADD COLUMN match_date_iso TEXT`)
  },
  {
    name: 'idx_fix_date',
    isApplied: (db) => indexExists(db, 'idx_fix_date'),
    apply: (db) => db.exec(`CREATE INDEX IF NOT EXISTS idx_fix_date ON fixtures(match_date_iso)`)
  },
  {
    name: 'settings:create',
    isApplied: (db) => tableExists(db, 'settings'),
    apply: (db) =>
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
  },
  {
    name: 'fixtures:match_type',
    isApplied: (db) => columnExists(db, 'fixtures', 'match_type'),
    apply: (db) =>
      db.exec(`ALTER TABLE fixtures ADD COLUMN match_type TEXT NOT NULL DEFAULT 'league'`)
  },
  {
    name: 'player_match_highlights:create',
    isApplied: (db) => tableExists(db, 'player_match_highlights'),
    apply: (db) =>
      db.exec(`
        CREATE TABLE player_match_highlights (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id  INTEGER NOT NULL REFERENCES players(player_id),
          fixture_id TEXT    NOT NULL REFERENCES fixtures(fixture_id),
          note       TEXT,
          tagged_by  TEXT,
          tagged_at  TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(player_id, fixture_id)
        )
      `)
  },
  {
    name: 'fixture_tags:create_and_backfill',
    isApplied: (db) => tableExists(db, 'fixture_tags'),
    apply: (db) => {
      db.exec(`
        CREATE TABLE fixture_tags (
          fixture_id TEXT NOT NULL REFERENCES fixtures(fixture_id) ON DELETE CASCADE,
          tag        TEXT NOT NULL CHECK(tag IN ('league','cup','friendly','indoor','internal')),
          PRIMARY KEY (fixture_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_tags ON fixture_tags(fixture_id);
      `)
      // Backfill existing non-league match_type values as tags.
      // 'league' is the implicit default — skip it to keep the table sparse.
      db.exec(`
        INSERT OR IGNORE INTO fixture_tags (fixture_id, tag)
        SELECT fixture_id, match_type FROM fixtures
        WHERE match_type IS NOT NULL AND match_type != 'league'
      `)
    }
  }
]

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const already = new Set(
    db
      .prepare(`SELECT name FROM schema_migrations`)
      .all()
      .map((r) => r.name)
  )
  const record = db.prepare(`INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)`)

  for (const m of MIGRATIONS) {
    if (already.has(m.name)) continue
    if (m.isApplied(db)) {
      record.run(m.name)
    } else {
      m.apply(db)
      record.run(m.name)
    }
  }
}

module.exports = { runMigrations, columnExists, tableExists, indexExists }
