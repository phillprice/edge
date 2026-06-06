// Manual test for the cron-job.org ingest flow.
// 1. Plants a token on an existing scheduled_fixture row
// 2. POSTs to the local ingest endpoint as cron-job.org would
// Usage: node test-cron-ingest.js [playCricketId]
require('dotenv').config()
const http = require('http')
const { randomUUID } = require('crypto')
const { getDb } = require('./db/schema')

const playCricketId = process.argv[2]
if (!playCricketId) {
  const db = getDb()
  const rows = db.prepare(`SELECT play_cricket_id, home_team, away_team, status FROM scheduled_fixtures ORDER BY match_date_iso DESC LIMIT 5`).all()
  console.log('Recent scheduled fixtures:')
  rows.forEach(r => console.log(`  ${r.play_cricket_id}  ${r.home_team} vs ${r.away_team}  [${r.status}]`))
  console.log('\nUsage: node test-cron-ingest.js <playCricketId>')
  process.exit(0)
}

const db = getDb()
const token = randomUUID()
db.prepare(`UPDATE scheduled_fixtures SET ingest_token = ?, status = 'pending' WHERE play_cricket_id = ?`).run(token, playCricketId)
console.log(`Token planted for fixture ${playCricketId}: ${token}`)

const port = process.env.PORT || 3001
const body = ''
const req = http.request({
  hostname: 'localhost',
  port,
  path: `/api/admin/scheduler/ingest/${playCricketId}`,
  method: 'POST',
  headers: { 'X-Ingest-Token': token, 'Content-Length': 0 },
}, res => {
  let data = ''
  res.on('data', c => data += c)
  res.on('end', () => console.log(`Response ${res.statusCode}:`, data))
})
req.on('error', e => console.error('Request failed:', e.message))
req.end(body)
