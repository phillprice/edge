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
  // ── Phase 1: multi-club schema ────────────────────────────────────────────
  {
    name: 'clubs:create',
    isApplied: (db) => tableExists(db, 'clubs'),
    apply: (db) =>
      db.exec(`
        CREATE TABLE clubs (
          club_id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name                 TEXT NOT NULL,
          slug                 TEXT NOT NULL UNIQUE,
          play_cricket_domain  TEXT NOT NULL,
          primary_colour       TEXT NOT NULL DEFAULT '#690028',
          secondary_colour     TEXT NOT NULL DEFAULT '#a00040',
          app_name             TEXT NOT NULL DEFAULT 'Edge XI'
        )
      `)
  },
  {
    name: 'clubs:seed-whcc',
    isApplied: (db) =>
      !!db.prepare(`SELECT 1 FROM clubs WHERE slug = 'whcc'`).get(),
    apply: (db) =>
      db.exec(`
        INSERT INTO clubs (name, slug, play_cricket_domain, primary_colour, secondary_colour, app_name)
        VALUES ('Woking & Horsell CC', 'whcc', 'whcc.play-cricket.com', '#690028', '#a00040', 'Edge XI')
      `)
  },
  {
    name: 'fixtures:club_id',
    isApplied: (db) => columnExists(db, 'fixtures', 'club_id'),
    apply: (db) => db.exec(`ALTER TABLE fixtures ADD COLUMN club_id INTEGER REFERENCES clubs(club_id)`)
  },
  {
    name: 'fixtures:club_id-backfill-whcc',
    isApplied: (db) =>
      !db.prepare(`SELECT 1 FROM fixtures WHERE club_id IS NULL LIMIT 1`).get(),
    apply: (db) =>
      db.exec(`UPDATE fixtures SET club_id = (SELECT club_id FROM clubs WHERE slug = 'whcc') WHERE club_id IS NULL`)
  },
  {
    name: 'watched_teams:club_id',
    isApplied: (db) => columnExists(db, 'watched_teams', 'club_id'),
    apply: (db) =>
      db.exec(`ALTER TABLE watched_teams ADD COLUMN club_id INTEGER REFERENCES clubs(club_id)`)
  },
  {
    name: 'watched_teams:club_id-backfill-whcc',
    isApplied: (db) =>
      !db.prepare(`SELECT 1 FROM watched_teams WHERE club_id IS NULL LIMIT 1`).get(),
    apply: (db) =>
      db.exec(`UPDATE watched_teams SET club_id = (SELECT club_id FROM clubs WHERE slug = 'whcc') WHERE club_id IS NULL`)
  },
  {
    name: 'scheduled_fixtures:club_id',
    isApplied: (db) => columnExists(db, 'scheduled_fixtures', 'club_id'),
    apply: (db) =>
      db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN club_id INTEGER REFERENCES clubs(club_id)`)
  },
  {
    name: 'scheduled_fixtures:club_id-backfill-whcc',
    isApplied: (db) =>
      !db.prepare(`SELECT 1 FROM scheduled_fixtures WHERE club_id IS NULL LIMIT 1`).get(),
    apply: (db) =>
      db.exec(`UPDATE scheduled_fixtures SET club_id = (SELECT club_id FROM clubs WHERE slug = 'whcc') WHERE club_id IS NULL`)
  },
  {
    name: 'clubs:name_markers',
    isApplied: (db) => columnExists(db, 'clubs', 'name_markers'),
    apply: (db) => {
      db.exec(
        `ALTER TABLE clubs ADD COLUMN name_markers TEXT NOT NULL DEFAULT '["whcc","horsell"]'`
      )
      db.exec(
        `UPDATE clubs SET name_markers = '["whcc","horsell"]' WHERE slug = 'whcc'`
      )
    }
  },
  {
    name: 'clubs:kit_colour',
    isApplied: (db) => columnExists(db, 'clubs', 'kit_colour'),
    apply: (db) =>
      db.exec(`ALTER TABLE clubs ADD COLUMN kit_colour TEXT`)
  },
  {
    name: 'invites:create',
    isApplied: (db) => tableExists(db, 'invites'),
    apply: (db) =>
      db.exec(`
        CREATE TABLE invites (
          token       TEXT PRIMARY KEY,
          club_id     INTEGER NOT NULL REFERENCES clubs(club_id),
          created_by  TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at  TEXT NOT NULL,
          used_at     TEXT,
          used_by     TEXT
        )
      `)
  },
  {
    // RunOut now credits fielder in MVP — flush stale caches so all matches recompute
    name: 'mvp-runout:flush-caches',
    isApplied: (db) => false,
    apply: (db) => {
      db.exec(`DELETE FROM mvp_cache`)
      if (tableExists(db, 'match_stats_cache')) db.exec(`DELETE FROM match_stats_cache`)
    }
  },
  {
    name: 'watched_teams:colour',
    isApplied: (db) => columnExists(db, 'watched_teams', 'colour'),
    apply: (db) => db.exec(`ALTER TABLE watched_teams ADD COLUMN colour TEXT`)
  },
  {
    // Run-out deliveries with unresolved batter names were incorrectly crediting
    // the bowler — flush caches so match list MVP/bowl stats recompute correctly.
    name: 'runout-querytopbowl:flush-caches',
    isApplied: (db) => false,
    apply: (db) => {
      db.exec(`DELETE FROM mvp_cache`)
      if (tableExists(db, 'match_stats_cache')) db.exec(`DELETE FROM match_stats_cache`)
    }
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
      db.exec(`
        INSERT OR IGNORE INTO fixture_tags (fixture_id, tag)
        SELECT fixture_id, match_type FROM fixtures
        WHERE match_type IS NOT NULL AND match_type != 'league'
      `)
    }
  },
  {
    name: 'players:jersey_number',
    isApplied: (db) => columnExists(db, 'players', 'jersey_number'),
    apply: (db) => db.exec(`ALTER TABLE players ADD COLUMN jersey_number INTEGER`)
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
