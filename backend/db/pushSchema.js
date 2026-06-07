#!/usr/bin/env node
/**
 * Push schema to Turso by extracting DDL directly from the local SQLite DB.
 * Usage: DB_PATH=./cricket.db TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node db/pushSchema.js
 */
'use strict'
require('dotenv').config()
const { createClient } = require('@libsql/client')
const Database = require('better-sqlite3')
const path = require('path')

async function push() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'cricket.db')
  const url    = process.env.TURSO_DATABASE_URL
  const token  = process.env.TURSO_AUTH_TOKEN
  if (!url) { console.error('TURSO_DATABASE_URL not set'); process.exit(1) }

  const client = createClient({ url, authToken: token })
  const sqlite = new Database(dbPath, { readonly: true })

  const ddl = sqlite.prepare(
    "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name"
  ).all()
  sqlite.close()

  console.log('Pushing', ddl.length, 'DDL statements to', url, '...')
  let ok = 0
  for (const { sql } of ddl) {
    try { await client.execute(sql); ok++ }
    catch(e) {
      if (e.message.includes('already exists')) { ok++; continue }
      console.error('FAIL:', sql.slice(0,60), '|', e.message.slice(0,80))
    }
  }
  console.log('Done:', ok + '/' + ddl.length)
  client.close()
}

push().catch(e => { console.error(e.message); process.exit(1) })
