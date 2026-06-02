require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('@clerk/express');

const app = express();

app.use(cors());
app.use(express.json());

// Rate limiting — protects all API routes from abuse. Generous limit since the app is
// authenticated and legitimate sessions make many requests; tighten via env if needed.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const auth = process.env.CLERK_SECRET_KEY ? requireAuth() : (req, res, next) => next();

const requireUpload = process.env.CLERK_SECRET_KEY
  ? (req, res, next) => {
      try {
        const token = (req.headers.authorization || '').replace('Bearer ', '')
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
        if (claims?.metadata?.canUpload) return next()
      } catch {}
      return res.status(403).json({ error: 'Upload access not permitted' })
    }
  : (req, res, next) => next();

// cron-job.org callback — no Clerk auth; validated by per-fixture token
app.post('/api/admin/scheduler/ingest/:playCricketId', async (req, res) => {
  const { playCricketId } = req.params
  const token = req.headers['x-ingest-token']
  const db = require('./db/schema').getDb()
  const row = db.prepare(`SELECT * FROM scheduled_fixtures WHERE play_cricket_id = ?`).get(playCricketId)
  if (!row || !row.ingest_token || row.ingest_token !== token) {
    return res.status(403).json({ error: 'Invalid token' })
  }
  if (row.status === 'done') return res.json({ ok: true, alreadyDone: true })

  // If the fixture was manually ingested since this job was created, mark done and clean up
  const alreadyIngested = db.prepare(`SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`).get(String(playCricketId))
  if (alreadyIngested) {
    db.prepare(`UPDATE scheduled_fixtures SET status='done', ingest_token=NULL WHERE play_cricket_id=?`).run(playCricketId)
    if (row.cron_job_id) require('./utils/cronJobOrg').deleteJob(row.cron_job_id).catch(() => {})
    return res.json({ ok: true, alreadyDone: true })
  }

  // Clear token immediately to prevent replay attacks
  db.prepare(`UPDATE scheduled_fixtures SET ingest_token = NULL, attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`).run(playCricketId)

  try {
    const { ingestMatch } = require('./db/ingestMatch')
    const { fixtureId, results } = await ingestMatch(playCricketId)
    const { createIngestJob, deleteJob } = require('./utils/cronJobOrg')

    if (results.length === 0 && (row.attempt_count + 1) < 8) {
      // No innings data yet — match likely still in progress. Reschedule 60 min later.
      const { randomUUID } = require('crypto')
      const newToken = randomUUID()
      const newIngestAfter = new Date(Date.now() + 60 * 60_000).toISOString()
      db.prepare(`UPDATE scheduled_fixtures SET ingest_after=?, ingest_token=? WHERE play_cricket_id=?`)
        .run(newIngestAfter, newToken, playCricketId)
      createIngestJob(playCricketId, newIngestAfter, newToken).then(result => {
        if (result?.jobId) db.prepare(`UPDATE scheduled_fixtures SET cron_job_id=? WHERE play_cricket_id=?`).run(result.jobId, playCricketId)
        if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
      }).catch(e => console.error('[cron-ingest] requeue failed:', e.message))
      console.log(`[cron-ingest] no innings for ${playCricketId} — requeued for ${newIngestAfter}`)
      return res.json({ ok: true, requeued: true, nextAttempt: newIngestAfter })
    }

    db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=?, cron_job_id=NULL WHERE play_cricket_id=?`)
      .run(new Date().toISOString(), playCricketId)
    res.json({ ok: true })
    require('./utils/matchSummary').notifyMatchIngested(fixtureId)
      .catch(e => console.error('[cron-ingest] notify error:', e.message))
    if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
  } catch (e) {
    const exhausted = (row.attempt_count + 1) >= 5
    db.prepare(`UPDATE scheduled_fixtures SET status=?, error_msg=? WHERE play_cricket_id=?`)
      .run(exhausted ? 'failed' : 'pending', e.message, playCricketId)
    console.error(`[cron-ingest] failed ${playCricketId}:`, e.message)
    res.status(500).json({ error: e.message })
  }
});

// API routes
app.use('/api/ingest',           auth, requireUpload, require('./routes/ingest'));
app.use('/api/manual',           auth, requireUpload, require('./routes/manual'));
app.use('/api/admin',            auth, requireUpload, require('./routes/admin'));
app.use('/api/access-requests',  auth, require('./routes/accessRequests'));
app.use('/api/matches',          auth, require('./routes/matches'));
app.use('/api/players',          auth, require('./routes/players'));

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve frontend in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (require('fs').existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Cricket API running on http://localhost:${PORT}`)
  if (process.env.AUTO_INGEST_ENABLED !== 'false') require('./scheduler')
  try { require('./utils/matchSummary').backfillStatsCache() }
  catch (e) { console.error('[stats-cache] backfill error:', e.message) }
});
