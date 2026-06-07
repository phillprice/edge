#!/usr/bin/env node
/**
 * One-time migration: copy all data from the local SQLite DB to Turso.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node db/migrateToTurso.js
 *
 * Tables are migrated in dependency order (parent tables before child tables).
 * Runs in batches of 200 rows to avoid hitting Turso's request size limits.
 * Safe to re-run — uses INSERT OR IGNORE so existing rows are skipped.
 */
'use strict'
require('dotenv').config()

const Database = require('better-sqlite3')
const { createClient } = require('@libsql/client')
const path = require('path')

const BATCH_SIZE = 200

// Migration order respects FK dependencies
const TABLES = [
  'fixtures',
  'players',
  'innings',
  'deliveries',
  'dismissals',
  'player_flags',
  'match_captains',
  'wk_assignments',
  'wk_errors',
  'mvp_cache',
  'ingests',
  'watched_teams',
  'scheduled_fixtures',
  'match_detail_cache',
  'match_stats_cache',
  'access_requests',
  'fixture_seasons',
  'manual_extras',
  'manual_batting',
  'manual_bowling',
  'manual_fielding',
  'notification_prefs',
  'user_telegram',
  'team_subscriptions',
  'player_follows',
  'user_preferences',
]

function placeholders(n) { return Array.from({ length: n }, () => '?').join(', ') }

async function migrate() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'cricket.db')
  const url    = process.env.TURSO_DATABASE_URL
  const token  = process.env.TURSO_AUTH_TOKEN

  if (!url) { console.error('TURSO_DATABASE_URL not set'); process.exit(1) }
  if (!require('fs').existsSync(dbPath)) { console.error('SQLite DB not found at', dbPath); process.exit(1) }

  const sqlite = new Database(dbPath, { readonly: true })
  const turso  = createClient({ url, authToken: token })

  console.log(`Migrating from ${dbPath} → ${url}\n`)

  for (const table of TABLES) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all()
    if (!rows.length) { console.log(`  ${table}: 0 rows (skipped)`); continue }

    const cols = Object.keys(rows[0])
    const insertSql = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})`

    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const statements = batch.map(row => ({
        sql: insertSql,
        args: cols.map(c => row[c] ?? null),
      }))
      await turso.batch(statements, 'write')
      inserted += batch.length
    }
    console.log(`  ${table}: ${inserted} rows`)
  }

  sqlite.close()
  turso.close()
  console.log('\nMigration complete.')
}

migrate().catch(e => { console.error(e); process.exit(1) })
