// Manual test for the cron-job.org ingest flow.
// 1. Plants a token on an existing scheduled_fixture row
// 2. POSTs to the local ingest endpoint as cron-job.org would
// Usage: node test-cron-ingest.js [playCricketId]
// Note: http (not https) is intentional — this only ever connects to localhost.
require('dotenv').config()
// nosemgrep: javascript.lang.security.audit.non-literal-require.non-literal-require, javascript.lang.security.audit.insecure-http-request.insecure-http-request
const http = require('http') // nosemgrep
const { randomUUID } = require('crypto')
const { getDb } = require('./db/schema')

const playCricketId = process.argv[2]
if (!playCricketId) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT play_cricket_id, home_team, away_team, status FROM scheduled_fixtures ORDER BY match_date_iso DESC LIMIT 5`
    )
    .all()
  console.log('Recent scheduled fixtures:')
  rows.forEach((r) =>
    console.log(`  ${r.play_cricket_id}  ${r.home_team} vs ${r.away_team}  [${r.status}]`)
  )
  console.log('\nUsage: node test-cron-ingest.js <playCricketId>')
  process.exit(0)
}

const db = getDb()
const token = randomUUID()
db.prepare(
  `UPDATE scheduled_fixtures SET ingest_token = ?, status = 'pending' WHERE play_cricket_id = ?`
).run(token, playCricketId)
console.log(`Token planted for fixture ${playCricketId}: ${token}`)

const port = process.env.PORT || 3001
const body = ''
// skipcq: JS-W1008, JS-S1000
const req = http.request(
  {
    // nosemgrep
    hostname: 'localhost',
    port,
    path: '/api/admin/scheduler/ingest/' + playCricketId,
    method: 'POST',
    headers: { 'X-Ingest-Token': token, 'Content-Length': 0 }
  },
  (res) => {
    let data = ''
    res.on('data', (c) => {
      data += c
    })
    res.on('end', () => process.stdout.write('Response ' + res.statusCode + ': ' + data + '\n'))
  }
)
req.on('error', (e) => console.error('Request failed:', e.message))
req.end(body)
