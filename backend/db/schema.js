const Database = require('better-sqlite3');
const path = require('path');

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

    CREATE INDEX IF NOT EXISTS idx_del_result   ON deliveries(result_id);
    CREATE INDEX IF NOT EXISTS idx_del_batter   ON deliveries(batter_id);
    CREATE INDEX IF NOT EXISTS idx_del_bowler   ON deliveries(bowler_id);
    CREATE INDEX IF NOT EXISTS idx_inn_fixture  ON innings(fixture_id);


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

    CREATE TABLE IF NOT EXISTS player_flags (
      fixture_id  TEXT NOT NULL REFERENCES fixtures(fixture_id),
      player_id   INTEGER NOT NULL REFERENCES players(player_id),
      is_captain  INTEGER NOT NULL DEFAULT 0,
      is_wk       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (fixture_id, player_id)
    );

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

    CREATE TABLE IF NOT EXISTS wk_errors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id    TEXT NOT NULL REFERENCES fixtures(fixture_id),
      innings_order INTEGER NOT NULL,
      player_id     INTEGER NOT NULL REFERENCES players(player_id),
      error_type    TEXT NOT NULL CHECK(error_type IN ('dropped_catch','missed_stumping'))
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

  // Migrations (safe to run repeatedly — fail silently if column already exists)
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

  // Recreate display-name view so it always reflects the current schema
  db.exec(`DROP VIEW IF EXISTS players_dn`)
  db.exec(`CREATE VIEW players_dn AS SELECT player_id, team, COALESCE(display_name, name) AS name, is_sub FROM players`)

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
  `);
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = { getDb, closeDb, DB_PATH };
