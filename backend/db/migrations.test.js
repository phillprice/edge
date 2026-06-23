'use strict'

const path = require('path')
const Database = require('better-sqlite3')
const { runMigrations, columnExists, tableExists, indexExists } = require('./migrations')

// Use a fresh in-memory DB for each test group
function freshDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  return db
}

// Minimal schema that runMigrations needs to work against (tables must exist for ALTERs)
function buildMinimalSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_fixtures (
      play_cricket_id INTEGER PRIMARY KEY,
      team_id INTEGER, season_id INTEGER, match_date_iso TEXT,
      ingest_after TEXT, discovered_at TEXT, attempt_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS wk_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT, innings_order INTEGER, player_id INTEGER, from_over INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS fixtures (
      fixture_id TEXT PRIMARY KEY,
      home_team TEXT, away_team TEXT, ground TEXT,
      match_date TEXT, competition TEXT
    );
    CREATE TABLE IF NOT EXISTS manual_batting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT, innings_order INTEGER DEFAULT 1, player_id INTEGER,
      runs INTEGER DEFAULT 0, balls INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS manual_extras (
      fixture_id TEXT PRIMARY KEY, batting_extras INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS players (
      player_id INTEGER PRIMARY KEY, name TEXT NOT NULL, team TEXT
    );
    CREATE TABLE IF NOT EXISTS ingests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT, clerk_user_id TEXT, ingested_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS mvp_cache (
      fixture_id INTEGER PRIMARY KEY,
      players_json TEXT, meta_json TEXT, computed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS watched_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER, season_id INTEGER, label TEXT, added_at TEXT
    );
    CREATE TABLE IF NOT EXISTS dismissals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT NOT NULL,
      innings_order INTEGER NOT NULL,
      batter_id INTEGER,
      bowler_id INTEGER,
      fielder_id INTEGER,
      method TEXT NOT NULL,
      raw_batter TEXT,
      raw_bowler TEXT,
      raw_fielder TEXT
    );
  `)
}

describe('helpers', () => {
  it('columnExists returns true for an existing column', () => {
    const db = freshDb()
    db.exec(`CREATE TABLE t (a TEXT, b INTEGER)`)
    expect(columnExists(db, 't', 'a')).toBe(true)
    expect(columnExists(db, 't', 'z')).toBe(false)
  })

  it('tableExists returns true for an existing table', () => {
    const db = freshDb()
    db.exec(`CREATE TABLE t (x TEXT)`)
    expect(tableExists(db, 't')).toBe(true)
    expect(tableExists(db, 'missing')).toBe(false)
  })

  it('indexExists returns true for an existing index', () => {
    const db = freshDb()
    db.exec(`CREATE TABLE t (x TEXT); CREATE INDEX idx_t_x ON t(x)`)
    expect(indexExists(db, 'idx_t_x')).toBe(true)
    expect(indexExists(db, 'idx_missing')).toBe(false)
  })
})

describe('runMigrations on a fresh schema', () => {
  it('creates schema_migrations table and records all migrations', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(tableExists(db, 'schema_migrations')).toBe(true)
    const rows = db.prepare(`SELECT name FROM schema_migrations`).all()
    expect(rows.length).toBeGreaterThan(20)
  })

  it('adds all expected columns to fixtures', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(columnExists(db, 'fixtures', 'format')).toBe(true)
    expect(columnExists(db, 'fixtures', 'starting_score')).toBe(true)
    expect(columnExists(db, 'fixtures', 'play_cricket_id')).toBe(true)
    expect(columnExists(db, 'fixtures', 'max_overs')).toBe(true)
    expect(columnExists(db, 'fixtures', 'match_date_iso')).toBe(true)
  })

  it('adds all expected columns to players', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(columnExists(db, 'players', 'display_name')).toBe(true)
    expect(columnExists(db, 'players', 'is_sub')).toBe(true)
    expect(columnExists(db, 'players', 'ignore_flag')).toBe(true)
  })

  it('creates user_preferences and settings tables', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(tableExists(db, 'user_preferences')).toBe(true)
    expect(tableExists(db, 'settings')).toBe(true)
  })

  it('creates clubs table and seeds WHCC row', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(tableExists(db, 'clubs')).toBe(true)
    const whcc = db.prepare(`SELECT * FROM clubs WHERE slug = 'whcc'`).get()
    expect(whcc).toBeDefined()
    expect(whcc.name).toBe('Woking & Horsell CC')
    expect(whcc.play_cricket_domain).toBe('whcc.play-cricket.com')
  })

  it('adds club_id to fixtures, watched_teams, scheduled_fixtures', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)

    expect(columnExists(db, 'fixtures', 'club_id')).toBe(true)
    expect(columnExists(db, 'watched_teams', 'club_id')).toBe(true)
    expect(columnExists(db, 'scheduled_fixtures', 'club_id')).toBe(true)
  })

  it('rebuilds mvp_cache when fixture_id was INTEGER', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    // mvp_cache already has INTEGER fixture_id in buildMinimalSchema — migration should fix it
    runMigrations(db)

    const col = db
      .prepare(`PRAGMA table_info(mvp_cache)`)
      .all()
      .find((c) => c.name === 'fixture_id')
    expect(col.type.toUpperCase()).toBe('TEXT')
  })
})

describe('runMigrations is idempotent', () => {
  it('running twice produces no error and the same migration count', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    runMigrations(db)
    const count1 = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get().n

    runMigrations(db)
    const count2 = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get().n

    expect(count1).toBe(count2)
  })

  it('pre-applied columns are recorded without re-running DDL', () => {
    const db = freshDb()
    buildMinimalSchema(db)
    // Add the column first so migration isApplied() returns true
    db.exec(`ALTER TABLE fixtures ADD COLUMN format TEXT NOT NULL DEFAULT 'standard'`)

    runMigrations(db)

    const row = db.prepare(`SELECT name FROM schema_migrations WHERE name=?`).get('fixtures:format')
    expect(row).toBeDefined()
    // No error means the ALTER was not attempted again
  })
})
