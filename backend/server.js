require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const { apiLimiter } = require('./middleware/rateLimit')
const { attachAuthContext, requireSignedIn, requireUpload } = require('./middleware/auth')

const app = express() // nosemgrep: CSRF not applicable — auth uses Clerk JWTs (Bearer header), not cookies
app.set('trust proxy', 1) // Fly.io terminates TLS and sets X-Forwarded-For

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
  : ['http://localhost:5173', 'http://localhost:3001']
app.use(cors({ origin: CORS_ORIGINS, credentials: true }))
app.use(express.json())

// cron-job.org daily discovery callback — no Clerk auth; validated by DISCOVER_TOKEN header
app.post('/api/admin/scheduler/discover', apiLimiter, (req, res) => {
  const expectedToken = process.env.DISCOVER_TOKEN
  if (!expectedToken || req.headers['x-discover-token'] !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token' })
  }
  // Kick off discovery asynchronously — respond immediately so cron-job.org doesn't retry
  require('./scheduler')
    .discoverFixtures()
    .catch((e) => {
      console.error('[cron-discover] error:', e.message)
      require('./utils/notifications')
        .notifyServiceAlert({ message: 'Fixture discovery failed', detail: e.message })
        .catch(() => {})
    })
  return res.json({ ok: true })
})

// cron-job.org callback — no Clerk auth; validated by per-fixture token
app.post('/api/admin/scheduler/ingest/:playCricketId', apiLimiter, async (req, res) => {
  const { playCricketId } = req.params
  const token = req.headers['x-ingest-token']
  const db = require('./db/schema').getDb()
  const row = db
    .prepare(`SELECT * FROM scheduled_fixtures WHERE play_cricket_id = ?`)
    .get(playCricketId)
  if (!row || !row.ingest_token || row.ingest_token !== token) {
    return res.status(403).json({ error: 'Invalid token' })
  }
  if (row.status === 'done') return res.json({ ok: true, alreadyDone: true })

  // If the fixture was manually ingested since this job was created, mark done and clean up
  const alreadyIngested = db
    .prepare(`SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`)
    .get(String(playCricketId))
  if (alreadyIngested) {
    db.prepare(
      `UPDATE scheduled_fixtures SET status='done', ingest_token=NULL WHERE play_cricket_id=?`
    ).run(playCricketId)
    if (row.cron_job_id)
      require('./utils/cronJobOrg')
        .deleteJob(row.cron_job_id)
        .catch(() => {})
    return res.json({ ok: true, alreadyDone: true })
  }

  // Clear token immediately to prevent replay attacks
  db.prepare(
    `UPDATE scheduled_fixtures SET ingest_token = NULL, attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`
  ).run(playCricketId)

  try {
    const { ingestMatch } = require('./db/ingestMatch')
    const { fixtureId, results } = await ingestMatch(playCricketId)
    const { createIngestJob, deleteJob } = require('./utils/cronJobOrg')

    if (results.length === 0 && row.attempt_count + 1 < 8) {
      // No innings data yet — match likely still in progress. Reschedule 60 min later.
      const { randomUUID } = require('crypto')
      const newToken = randomUUID()
      const newIngestAfter = new Date(Date.now() + 60 * 60_000).toISOString()
      db.prepare(
        `UPDATE scheduled_fixtures SET ingest_after=?, ingest_token=? WHERE play_cricket_id=?`
      ).run(newIngestAfter, newToken, playCricketId)
      createIngestJob(playCricketId, newIngestAfter, newToken)
        .then((result) => {
          if (result?.jobId)
            db.prepare(`UPDATE scheduled_fixtures SET cron_job_id=? WHERE play_cricket_id=?`).run(
              result.jobId,
              playCricketId
            )
          if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
        })
        .catch((e) => console.error('[cron-ingest] requeue failed:', e.message))
      console.log(`[cron-ingest] no innings for ${playCricketId} — requeued for ${newIngestAfter}`)
      return res.json({ ok: true, requeued: true, nextAttempt: newIngestAfter })
    }

    db.prepare(
      `UPDATE scheduled_fixtures SET status='done', ingested_at=?, cron_job_id=NULL WHERE play_cricket_id=?`
    ).run(new Date().toISOString(), playCricketId)
    res.json({ ok: true })
    require('./utils/matchSummary')
      .notifyMatchIngested(fixtureId)
      .catch((e) => console.error('[cron-ingest] notify error:', e.message))
    if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
    // Roll the window forward — this job just fired, so queue the next one
    require('./scheduler')
      .topUpCronJobs(db)
      .catch((e) => console.error('[cron-ingest] top-up error:', e.message))
  } catch (e) {
    const exhausted = row.attempt_count + 1 >= 5
    db.prepare(`UPDATE scheduled_fixtures SET status=?, error_msg=? WHERE play_cricket_id=?`).run(
      exhausted ? 'failed' : 'pending',
      e.message,
      playCricketId
    )
    console.error(`[cron-ingest] failed ${playCricketId}:`, e.message)
    res.status(500).json({ error: e.message })
    // Even on failure, roll the window in case this slot can be filled by the next fixture
    require('./scheduler')
      .topUpCronJobs(db)
      .catch((e2) => console.error('[cron-ingest] top-up error:', e2.message))
  }
})

// Verify the Clerk session JWT once per request and attach req.authCtx (runs after the
// cron callback above, which has its own token auth and must stay Clerk-exempt).
app.use('/api/', attachAuthContext)

// Telegram bot webhook — no Clerk auth; secured by TELEGRAM_WEBHOOK_SECRET header
const telegramRoutes = require('./routes/telegram')
app.use('/api/telegram', telegramRoutes.router)

// API routes — requireSignedIn rejects anonymous/forged tokens; requireUpload gates writes.
app.use('/api/ingest', requireSignedIn, requireUpload, require('./routes/ingest'))
app.use('/api/manual', requireSignedIn, requireUpload, require('./routes/manual'))
app.use('/api/admin', requireSignedIn, requireUpload, require('./routes/admin'))
app.use('/api/access-requests', requireSignedIn, require('./routes/accessRequests'))
app.use('/api/matches', requireSignedIn, require('./routes/matches'))
app.use('/api/players', requireSignedIn, require('./routes/players'))

// Notification preferences — unsubscribe is public (token-based), rest requires sign-in
const notifRoutes = require('./routes/notifications')
app.get('/api/notifications/unsubscribe', apiLimiter, notifRoutes.unsubscribeHandler)
app.use('/api/notifications', requireSignedIn, notifRoutes.router)

// Health check
app.get('/api/health', apiLimiter, (_, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
)

// Global error handler — always return JSON, never leak stack traces as HTML.
// Sentry's Node SDK will capture errors logged here if SENTRY_DSN is configured.

app.use((err, req, res, _next) => {
  console.error('[api error]', req.method, req.path, err)
  const status = err.status || err.statusCode || 500
  res
    .status(status)
    .json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message })
})

// Serve frontend in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist')
if (require('fs').existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  // SPA fallback. Express 5 (path-to-regexp v8) rejects a bare '*' — the wildcard must be
  // named ('/*splat' matches every path, including '/').
  app.get('/*splat', (_, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Cricket API running on http://localhost:${PORT}`)
  if (process.env.AUTO_INGEST_ENABLED !== 'false') require('./scheduler')
  try {
    require('./utils/matchSummary').backfillFixtureSummaries()
  } catch (e) {
    console.error('[fixture-summary] backfill error:', e.message)
  }
  try {
    require('./utils/matchSummary').backfillStatsCache()
  } catch (e) {
    console.error('[stats-cache] backfill error:', e.message)
  }
  telegramRoutes.registerWebhook()
})
