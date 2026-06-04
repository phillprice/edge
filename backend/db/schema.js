const Database = require('better-sqlite3');
const path = require('path');
const { toIsoDate } = require('../utils/cricket');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'cricket.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixtures (
      fixture_id    TEXT PRIMARY KEY,
      home_team     TEXT,
      away_team     TEXT,
      ground        TEXT,
      match_date    TEXT,
      competition   TEXT,
      toss_winner   TEXT,
      toss_decision TEXT,
      result        TEXT,
      home_score    TEXT,
      away_score    TEXT,
      home_overs    TEXT,
      away_overs    TEXT,
      home_wickets  TEXT,
      away_wickets  TEXT,
      loaded_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS innings (
      result_id     INTEGER PRIMARY KEY,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS players (
      player_id   INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      team        TEXT
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id               INTEGER NOT NULL REFERENCES innings(result_id),
      innings_number          INTEGER NOT NULL,
      over_no                 INTEGER NOT NULL,
      ball_no                 INTEGER NOT NULL,
      ball_no_disp            INTEGER,
      batter_id               INTEGER NOT NULL,
      batter_id_ns            INTEGER,
      bowler_id               INTEGER NOT NULL,
      dismissed_batter_id     INTEGER,
      runs_bat                INTEGER NOT NULL DEFAULT 0,
      runs_extra              INTEGER NOT NULL DEFAULT 0,
      extras_type             INTEGER,
      l_desc                  TEXT,
      s_desc                  TEXT,
      last_update_time        TEXT,
      UNIQUE(result_id, innings_number, over_no, ball_no, ball_no_disp)
    );

    CREATE INDEX IF NOT EXISTS idx_del_result    ON deliveries(result_id);
    CREATE INDEX IF NOT EXISTS idx_del_batter    ON deliveries(batter_id);
    CREATE INDEX IF NOT EXISTS idx_del_bowler    ON deliveries(bowler_id);
    CREATE INDEX IF NOT EXISTS idx_del_batter_ns ON deliveries(batter_id_ns);
    CREATE INDEX IF NOT EXISTS idx_inn_fixture   ON innings(fixture_id);

    CREATE TABLE IF NOT EXISTS dismissals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL,
      batter_id     INTEGER REFERENCES players(player_id),
      bowler_id     INTEGER REFERENCES players(player_id),
      fielder_id    INTEGER REFERENCES players(player_id),
      method        TEXT NOT NULL,
      raw_batter    TEXT,
      raw_bowler    TEXT,
      raw_fielder   TEXT,
      UNIQUE(fixture_id, innings_order, raw_batter)
    );

    CREATE INDEX IF NOT EXISTS idx_dis_batter  ON dismissals(batter_id);
    CREATE INDEX IF NOT EXISTS idx_dis_bowler  ON dismissals(bowler_id);
    CREATE INDEX IF NOT EXISTS idx_dis_fielder ON dismissals(fielder_id);
    CREATE INDEX IF NOT EXISTS idx_dis_fixture ON dismissals(fixture_id);

    CREATE TABLE IF NOT EXISTS player_flags (
      fixture_id  TEXT NOT NULL REFERENCES fixtures(fixture_id),
      player_id   INTEGER NOT NULL REFERENCES players(player_id),
      is_captain  INTEGER NOT NULL DEFAULT 0,
      is_wk       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (fixture_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pf_player ON player_flags(player_id);

    CREATE TABLE IF NOT EXISTS match_captains (
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      PRIMARY KEY (fixture_id, innings_order)
    );

    CREATE TABLE IF NOT EXISTS wk_assignments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      from_over     INTEGER NOT NULL DEFAULT 1,
      UNIQUE(fixture_id, innings_order, from_over)
    );

    CREATE INDEX IF NOT EXISTS idx_wka_player ON wk_assignments(player_id);

    CREATE TABLE IF NOT EXISTS wk_errors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      error_type    TEXT NOT NULL CHECK(error_type IN ('dropped_catch','missed_stumping'))
    );

    CREATE TABLE IF NOT EXISTS mvp_cache (
      fixture_id   TEXT PRIMARY KEY,
      players_json TEXT NOT NULL,
      meta_json    TEXT NOT NULL,
      computed_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingests (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id     TEXT,
      clerk_user_id  TEXT,
      ingested_at    INTEGER NOT NULL,
      source_files   TEXT,
      row_counts     TEXT,
      FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_teams (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id    INTEGER NOT NULL,
      season_id  INTEGER NOT NULL,
      label      TEXT NOT NULL,
      added_at   TEXT NOT NULL,
      UNIQUE(team_id, season_id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_fixtures (
      play_cricket_id  INTEGER PRIMARY KEY,
      team_id          INTEGER NOT NULL,
      season_id        INTEGER NOT NULL,
      match_date_iso   TEXT NOT NULL,
      ingest_after     TEXT NOT NULL,
      discovered_at    TEXT NOT NULL,
      ingested_at      TEXT,
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'pending',
      error_msg        TEXT,
      home_team        TEXT,
      away_team        TEXT,
      ground           TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS match_detail_cache (
      fixture_id         TEXT PRIMARY KEY REFERENCES fixtures(fixture_id),
      partnerships_json  TEXT NOT NULL DEFAULT '[]',
      phases_json        TEXT NOT NULL DEFAULT '[]',
      computed_at        INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS match_stats_cache (
      fixture_id        TEXT PRIMARY KEY REFERENCES fixtures(fixture_id),
      top_bat_name      TEXT,
      top_bat_runs      INTEGER,
      top_bat_balls     INTEGER,
      top_bowl_name     TEXT,
      top_bowl_wickets  INTEGER,
      top_bowl_runs     INTEGER,
      mvp_name          TEXT,
      mvp_pts           REAL,
      computed_at       INTEGER NOT NULL
    )
  `)

  // Migrations (safe to run repeatedly — fail silently if column already exists)
  try { db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN home_team TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN away_team TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN ground TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN ingest_token TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE scheduled_fixtures ADD COLUMN cron_job_id INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE wk_assignments ADD COLUMN to_over INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE fixtures ADD COLUMN format TEXT NOT NULL DEFAULT 'standard'`) } catch (_) {}
  try { db.exec(`ALTER TABLE fixtures ADD COLUMN starting_score INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_batting ADD COLUMN did_not_bat INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_extras ADD COLUMN bowling_byes INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_extras ADD COLUMN bowling_leg_byes INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_extras ADD COLUMN whcc_overs TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_extras ADD COLUMN opp_overs TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE manual_batting ADD COLUMN times_out INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE players ADD COLUMN display_name TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE players ADD COLUMN is_sub INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE players ADD COLUMN ignore_flag INTEGER NOT NULL DEFAULT 0`) } catch (_) {}
  try { db.exec(`ALTER TABLE fixtures ADD COLUMN play_cricket_id TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE ingests ADD COLUMN clerk_user_name TEXT`) } catch (_) {}
  // Maximum overs per innings — drives phase boundaries, milestone thresholds, and MVP weights
  // Maximum overs per innings — used for balls-remaining calculation when first team all out early
  try { db.exec(`ALTER TABLE fixtures ADD COLUMN max_overs INTEGER NOT NULL DEFAULT 20`) } catch (_) {}
  try { db.exec(`ALTER TABLE watched_teams ADD COLUMN year TEXT`) } catch (_) {}

  // mvp_cache.fixture_id must be TEXT — manual fixture ids ('manual-…') aren't integers and
  // throw "datatype mismatch" against the old INTEGER PRIMARY KEY. Recreate if needed; it's a
  // cache, so the (lost) rows simply recompute on next request.
  try {
    const fxCol = db.prepare(`PRAGMA table_info(mvp_cache)`).all().find(c => c.name === 'fixture_id')
    if (fxCol && fxCol.type.toUpperCase() !== 'TEXT') {
      db.exec(`DROP TABLE mvp_cache`)
      db.exec(`CREATE TABLE mvp_cache (
        fixture_id   TEXT PRIMARY KEY,
        players_json TEXT NOT NULL,
        meta_json    TEXT NOT NULL,
        computed_at  INTEGER NOT NULL
      )`)
    }
  } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      clerk_user_id  TEXT NOT NULL,
      user_name      TEXT,
      user_email     TEXT,
      team_id        INTEGER NOT NULL,
      season_id      INTEGER NOT NULL,
      requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
      status         TEXT NOT NULL DEFAULT 'pending',
      resolved_by    TEXT,
      resolved_at    TEXT,
      UNIQUE(clerk_user_id, team_id, season_id)
    )
  `)

  // Maps every fixture (ingested OR manual) to the watched team+season it belongs to.
  // This is the single source the access filter joins on, so manual matches — which have no
  // play_cricket_id and thus no scheduled_fixtures row — are scoped identically to ingested ones.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixture_seasons (
      fixture_id  TEXT    NOT NULL REFERENCES fixtures(fixture_id),
      team_id     INTEGER NOT NULL,
      season_id   INTEGER NOT NULL,
      PRIMARY KEY (fixture_id, team_id, season_id)
    )
  `)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fixseasons_team ON fixture_seasons(team_id, season_id)`) } catch (_) {}
  // Backfill from scheduled_fixtures so existing ingested matches are covered immediately.
  try {
    db.exec(`
      INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id)
      SELECT f.fixture_id, sf.team_id, sf.season_id
      FROM scheduled_fixtures sf
      JOIN fixtures f ON CAST(f.play_cricket_id AS INTEGER) = sf.play_cricket_id
    `)
  } catch (_) {}

  // Normalised ISO date — always YYYY-MM-DD, enables correct ORDER BY and simple year extraction
  try { db.exec(`ALTER TABLE fixtures ADD COLUMN match_date_iso TEXT`) } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_fix_date ON fixtures(match_date_iso)`) } catch (_) {}
  // Backfill: fix NULL values AND existing garbage values from unsupported date formats
  {
    const toFix = db.prepare(
      `SELECT fixture_id, match_date FROM fixtures WHERE match_date IS NOT NULL AND (match_date_iso IS NULL OR match_date_iso NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`
    ).all();
    const upd = db.prepare(`UPDATE fixtures SET match_date_iso = ? WHERE fixture_id = ?`);
    for (const row of toFix) {
      const iso = toIsoDate(row.match_date);
      if (iso) upd.run(iso, row.fixture_id);
    }
  }

  // Recreate display-name view so it always reflects the current schema
  db.exec(`DROP VIEW IF EXISTS players_dn`)
  db.exec(`CREATE VIEW players_dn AS SELECT player_id, team, COALESCE(display_name, name) AS name, is_sub FROM players`)

  // Evict cached stats for fixtures where a player has a display_name override,
  // so the next request recomputes using players_dn (display names).
  try {
    db.exec(`
      DELETE FROM match_stats_cache WHERE fixture_id IN (
        SELECT DISTINCT i.fixture_id FROM innings i
        JOIN deliveries d ON d.result_id = i.result_id
        JOIN players p ON (p.player_id = d.batter_id OR p.player_id = d.bowler_id)
        WHERE p.display_name IS NOT NULL
      )
    `)
  } catch (_) {}

  // Manual stat entry tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_extras (
      fixture_id     TEXT NOT NULL PRIMARY KEY REFERENCES fixtures(fixture_id),
      batting_extras INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS manual_batting (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL DEFAULT 1,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      runs          INTEGER NOT NULL DEFAULT 0,
      balls         INTEGER NOT NULL DEFAULT 0,
      fours         INTEGER NOT NULL DEFAULT 0,
      sixes         INTEGER NOT NULL DEFAULT 0,
      not_out       INTEGER NOT NULL DEFAULT 0,
      how_out       TEXT,
      UNIQUE(fixture_id, innings_order, player_id)
    );
    CREATE TABLE IF NOT EXISTS manual_bowling (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id     TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order  INTEGER NOT NULL DEFAULT 2,
      player_id      INTEGER NOT NULL REFERENCES players(player_id),
      balls          INTEGER NOT NULL DEFAULT 0,
      maidens        INTEGER NOT NULL DEFAULT 0,
      wicket_maidens INTEGER NOT NULL DEFAULT 0,
      runs           INTEGER NOT NULL DEFAULT 0,
      wickets        INTEGER NOT NULL DEFAULT 0,
      wides          INTEGER NOT NULL DEFAULT 0,
      no_balls       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(fixture_id, innings_order, player_id)
    );

    CREATE TABLE IF NOT EXISTS manual_fielding (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL DEFAULT 2,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      catches       INTEGER NOT NULL DEFAULT 0,
      stumpings     INTEGER NOT NULL DEFAULT 0,
      run_outs      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(fixture_id, innings_order, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mb_player   ON manual_batting(player_id);
    CREATE INDEX IF NOT EXISTS idx_mb_fixture  ON manual_batting(fixture_id);
    CREATE INDEX IF NOT EXISTS idx_mbw_player  ON manual_bowling(player_id);
    CREATE INDEX IF NOT EXISTS idx_mbw_fixture ON manual_bowling(fixture_id);
    CREATE INDEX IF NOT EXISTS idx_mf_fixture  ON manual_fielding(fixture_id);
  `);
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = { getDb, closeDb, DB_PATH };
