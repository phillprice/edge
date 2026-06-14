require('dotenv').config()
const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const path = require('path')
const { apiLimiter, spaLimiter } = require('./middleware/rateLimit')
const { attachAuthContext, requireSignedIn, requireUpload } = require('./middleware/auth')

const app = express() // nosemgrep: CSRF not applicable — auth uses Clerk JWTs (Bearer header), not cookies
app.set('trust proxy', 1) // Fly.io terminates TLS and sets X-Forwarded-For
// Permissive starter CSP — tighten in the quality-ratchet phase once Clerk/Sentry/Vite
// allowlists are fully curated. crossOriginEmbedderPolicy disabled (Clerk iframes).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        fontSrc: ["'self'", 'data:', 'https:'],
        frameSrc: ['https:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
)

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

// cron-job.org fixed daily ingest cycle — no Clerk auth; validated by DISCOVER_TOKEN header
app.post('/api/admin/scheduler/ingest-cycle', apiLimiter, (req, res) => {
  const expectedToken = process.env.DISCOVER_TOKEN
  if (!expectedToken || req.headers['x-ingest-token'] !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token' })
  }
  res.json({ ok: true, message: 'Ingest cycle started' })
  require('./scheduler')
    .discoverFixtures()
    .then(() => require('./scheduler').processPendingIngests())
    .catch((e) => {
      console.error('[ingest-cycle] error:', e.message)
      require('./utils/notifications')
        .notifyServiceAlert({ message: 'Ingest cycle failed', detail: e.message })
        .catch(() => {})
    })
})

// Legacy per-fixture cron-job.org webhook — kept as a no-op for any old jobs still in the account.
app.post('/api/admin/scheduler/ingest/:playCricketId', apiLimiter, (req, res) => {
  console.log(
    `[cron-ingest] legacy per-fixture webhook called for ${req.params.playCricketId} — ignoring`
  )
  res.json({ ok: true, legacy: true })
})

// Rate-limit every /api route in one place (the cron callbacks above are registered
// earlier and carry their own inline limiter). Routers no longer apply apiLimiter
// themselves — it shares one store, so a second application would double-count.
app.use('/api/', apiLimiter)

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
app.get('/api/notifications/unsubscribe', notifRoutes.unsubscribeHandler)
app.use('/api/notifications', requireSignedIn, notifRoutes.router)

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }))

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
  app.get('/*splat', spaLimiter, (_, res) => res.sendFile(path.join(frontendDist, 'index.html')))
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
