'use strict'

const cron = require('node-cron')
const { fetchFixtureList, resolveTeamSeasons } = require('./utils/resultsvault')
const { getDb } = require('./db/schema')
const { notifyMatchIngested } = require('./utils/matchSummary')
const { createFixedIngestJob, deleteJob, listJobs } = require('./utils/cronJobOrg')

const DELAY_H = parseFloat(process.env.AUTO_INGEST_DELAY_HOURS || '4')

function addHours(isoStr, h) {
  const d = new Date(isoStr)
  d.setTime(d.getTime() + h * 3600_000)
  return d.toISOString()
}

// Spacing between staggered past-match ingest jobs (minutes).
// Keeps us well inside Play Cricket / ResultsVault rate limits.
const PAST_STAGGER_MIN = 2

// Matches age-group team labels (set once when the team is added to watched_teams).
// Checking the watched team's own label is more reliable than inspecting fixture team name
// strings, which may include WHCC's own age-group teams as an opponent.
const AGE_GROUP_LABEL_RE = /\b(?:junior|girls?|boys?|under\s*\d{1,2}s?|u\d{1,2}s?)\b/i

// Fixed daily ingest cycle times (Europe/London). Each fires a /ingest-cycle webhook that
// discovers new fixtures then ingests all that are past their threshold. All 5 fit within
// the cron-job.org free tier (5 jobs).
const FIXED_INGEST_SLOTS = [
  { hour: 0, minute: 0, key: 'fixed_ingest_job_0' },
  { hour: 12, minute: 0, key: 'fixed_ingest_job_1' },
  { hour: 15, minute: 0, key: 'fixed_ingest_job_2' },
  { hour: 19, minute: 0, key: 'fixed_ingest_job_3' },
  { hour: 22, minute: 0, key: 'fixed_ingest_job_4' }
]

// Insert scheduled_fixtures rows for one team/season's fixtures.
// Past-dated matches (whose natural ingest_after has already elapsed) are staggered into the
// near future. `stagger` is a shared mutable counter { n } so multiple teams/seasons queued in
// one pass don't all fire at the same instant. Returns the number of newly-inserted rows.
function queueFixtures(db, team_id, season_id, fixtures, stagger) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, ground)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const nowIso = new Date().toISOString()
  const nowMs = Date.now()
  let added = 0
  for (const f of fixtures) {
    const naturalAfter = addHours(f.matchDateIso, DELAY_H)
    const isPast = new Date(naturalAfter) < new Date()
    const ingestAfter = isPast
      ? new Date(nowMs + ++stagger.n * PAST_STAGGER_MIN * 60_000).toISOString()
      : naturalAfter
    const info = insert.run(
      f.playCricketId,
      team_id,
      season_id,
      f.matchDateIso,
      ingestAfter,
      nowIso,
      f.homeTeam,
      f.awayTeam,
      f.ground
    )
    if (info.changes) added++
  }
  return added
}

// Queue every season's fixtures for a freshly-added team, using the already-resolved
// resolveTeamSeasons() output so we don't re-fetch. Covers past seasons too (the daily
// discoverFixtures only re-scans current-year teams). Returns total rows queued.
function queueTeamSeasons(teamId, seasons) {
  const db = getDb()
  const stagger = { n: 0 }
  let total = 0
  for (const s of seasons) {
    if (s.label && AGE_GROUP_LABEL_RE.test(s.label)) {
      console.log(
        `[scheduler] skipping age-group team season ${teamId}/${s.season_id} (${s.label})`
      )
      continue
    }
    total += queueFixtures(db, parseInt(teamId), parseInt(s.season_id), s.fixtures, stagger)
  }
  if (total)
    console.log(
      `[scheduler] queued ${total} fixture(s) for team ${teamId} across ${seasons.length} season(s)`
    )
  return total
}

// Re-resolve every watched team's seasons and re-queue their fixtures. Backfills past seasons
// that the daily discoverFixtures skips (it only re-scans the current year). Safe to run
// repeatedly — queueFixtures uses INSERT OR IGNORE, so already-queued matches are untouched.
// Returns the number of newly-queued fixtures.
async function rescanAllSeasons() {
  const db = getDb()
  const teamIds = db
    .prepare('SELECT DISTINCT team_id FROM watched_teams')
    .all()
    .map((r) => r.team_id)
  let total = 0
  for (const teamId of teamIds) {
    try {
      const seasons = await resolveTeamSeasons(teamId)
      // Keep watched_teams labels/years current for any newly-discovered seasons.
      const upsert = db.prepare(`
        INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(team_id, season_id) DO UPDATE SET label = excluded.label, year = excluded.year
      `)
      for (const s of seasons) upsert.run(parseInt(teamId), parseInt(s.season_id), s.label, s.year)
      total += queueTeamSeasons(teamId, seasons)
    } catch (e) {
      console.error(`[scheduler] rescanAllSeasons failed for team ${teamId}:`, e.message)
    }
  }
  if (total)
    console.log(
      `[scheduler] rescanAllSeasons queued ${total} new fixture(s) across ${teamIds.length} team(s)`
    )
  return total
}

async function discoverFixtures() {
  const db = getDb()
  // Only re-scan teams for the current calendar year or later. Past seasons are complete —
  // their fixtures are queued once at add-time (via queueTeamSeasons), so re-scanning them
  // daily just wastes API calls and re-inserts done rows. Null-year rows included as fallback.
  const currentYear = String(new Date().getFullYear())
  const teams = db
    .prepare(
      'SELECT team_id, season_id, year, label FROM watched_teams WHERE year IS NULL OR year >= ?'
    )
    .all(currentYear)

  const stagger = { n: 0 }
  let total = 0
  for (const { team_id, season_id, year, label } of teams) {
    if (label && AGE_GROUP_LABEL_RE.test(label)) {
      console.log(`[scheduler] skipping age-group team ${team_id} (${label})`)
      continue
    }
    try {
      const fixtures = await fetchFixtureList(team_id, season_id, year)
      total += queueFixtures(db, team_id, season_id, fixtures, stagger)
    } catch (e) {
      console.error(`[scheduler] discoverFixtures failed for team ${team_id}:`, e.message)
    }
  }

  if (total) console.log(`[scheduler] discoverFixtures: ${total} new fixture(s) queued`)
  return total
}

// Exponential backoff schedule (minutes) applied to the NEXT retry after each failed
// attempt. Doubles from 15 min to 24 h; cumulative span ≈ 55 h, so a fixture keeps
// retrying for up to ~48 h before being marked 'failed'. The array length is the cap
// on total attempts.
const BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 960, 1440]
const MAX_ATTEMPTS = BACKOFF_MINUTES.length

async function processPendingIngests() {
  const db = getDb()
  const pending = db
    .prepare(
      `
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND attempt_count < ${MAX_ATTEMPTS}
    ORDER BY ingest_after
  `
    )
    .all()

  if (!pending.length) return

  // Clean up any rows where the match was already manually ingested
  for (const row of pending) {
    const alreadyIngested = db
      .prepare(`SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`)
      .get(String(row.play_cricket_id))
    if (alreadyIngested) {
      db.prepare(
        `UPDATE scheduled_fixtures SET status='done', ingested_at=COALESCE(ingested_at,?), ingest_token=NULL WHERE play_cricket_id=?`
      ).run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] fixture ${row.play_cricket_id} already ingested — marked done`)
    }
  }

  const { ingestMatch, ExcludedCompetitionError } = require('./db/ingestMatch')

  // Re-query after cleanup so we don't attempt already-done rows
  const stillPending = db
    .prepare(
      `
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND attempt_count < ${MAX_ATTEMPTS}
    ORDER BY ingest_after
  `
    )
    .all()

  for (const row of stillPending) {
    db.prepare(
      `UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`
    ).run(row.play_cricket_id)
    try {
      const { fixtureId } = await ingestMatch(row.play_cricket_id)
      if (fixtureId === null) {
        // No scorecard data yet — reset attempt counter so we don't exhaust retries
        // on an unplayed match, and push ingest_after forward by 30 minutes.
        const nextAfter = new Date(Date.now() + 30 * 60_000).toISOString()
        db.prepare(
          `UPDATE scheduled_fixtures SET attempt_count=0, ingest_after=? WHERE play_cricket_id=?`
        ).run(nextAfter, row.play_cricket_id)
        console.log(
          `[scheduler] fixture ${row.play_cricket_id} has no data yet — retrying in 30min`
        )
        continue
      }
      db.prepare(
        `UPDATE scheduled_fixtures SET status='done', ingested_at=?, ingest_token=NULL WHERE play_cricket_id=?`
      ).run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] ingested fixture ${row.play_cricket_id}`)
      notifyMatchIngested(fixtureId).catch((e) =>
        console.error('[scheduler] notify error:', e.message)
      )
    } catch (e) {
      if (e instanceof ExcludedCompetitionError) {
        db.prepare(
          `UPDATE scheduled_fixtures SET status='skipped', error_msg=?, ingest_token=NULL WHERE play_cricket_id=?`
        ).run(e.message, row.play_cricket_id)
        console.log(`[scheduler] skipped age-group fixture ${row.play_cricket_id}: ${e.message}`)
        continue
      }
      const newAttemptCount = row.attempt_count + 1
      const exhausted = newAttemptCount >= MAX_ATTEMPTS
      if (exhausted) {
        db.prepare(
          `UPDATE scheduled_fixtures SET status='failed', error_msg=? WHERE play_cricket_id=?`
        ).run(e.message, row.play_cricket_id)
        console.error(
          `[scheduler] failed fixture ${row.play_cricket_id} (gave up after ${newAttemptCount} attempts): ${e.message}`
        )
      } else {
        // Schedule the next retry with exponential backoff
        const delayMin = BACKOFF_MINUTES[newAttemptCount - 1]
        const nextAfter = new Date(Date.now() + delayMin * 60_000).toISOString()
        db.prepare(
          `UPDATE scheduled_fixtures SET status='pending', error_msg=?, ingest_after=? WHERE play_cricket_id=?`
        ).run(e.message, nextAfter, row.play_cricket_id)
        console.warn(
          `[scheduler] fixture ${row.play_cricket_id} attempt ${newAttemptCount} failed; retrying in ${delayMin}min: ${e.message}`
        )
      }
    }
  }
}

// Ensure all 5 fixed daily ingest cron jobs exist in cron-job.org. Checks live job list
// against IDs stored in settings; creates any that are missing. Safe to call on every
// startup — only creates jobs that don't already exist.
async function ensureFixedIngestJobs() {
  const token = process.env.DISCOVER_TOKEN
  if (!token) {
    console.log('[scheduler] DISCOVER_TOKEN not set — skipping cron-job.org ingest job setup')
    return
  }
  const key = process.env.CRON_JOB_ORG_API_KEY
  if (!key) {
    console.log('[scheduler] CRON_JOB_ORG_API_KEY not set — skipping cron-job.org ingest job setup')
    return
  }
  const base = process.env.APP_BASE_URL || 'https://edge.phillprice.com'
  if (base.includes('localhost') || base.includes('127.0.0.1')) return

  const db = getDb()

  // Load stored job IDs from settings
  const stored = {}
  for (const slot of FIXED_INGEST_SLOTS) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(slot.key)
    if (row) stored[slot.key] = parseInt(row.value, 10)
  }

  // Fetch live jobs once
  const liveRes = await listJobs().catch(() => null)
  const liveIds = new Set((liveRes?.jobs ?? []).map((j) => j.jobId))

  for (const slot of FIXED_INGEST_SLOTS) {
    const existingId = stored[slot.key]
    if (existingId && liveIds.has(existingId)) {
      console.log(
        `[scheduler] fixed ingest job ${slot.hour}:${String(slot.minute).padStart(2, '0')} already exists (#${existingId})`
      )
      continue
    }
    // Missing or stale — create it
    try {
      const result = await createFixedIngestJob(slot.hour, slot.minute, token)
      if (result?.jobId) {
        db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
          slot.key,
          String(result.jobId)
        )
        console.log(
          `[scheduler] created fixed ingest job ${slot.hour}:${String(slot.minute).padStart(2, '0')} → cron-job.org #${result.jobId}`
        )
      } else if (result !== null) {
        console.warn(
          `[scheduler] failed to create fixed ingest job ${slot.hour}:${String(slot.minute).padStart(2, '0')} — no jobId returned`
        )
      }
    } catch (e) {
      console.error(
        `[scheduler] ensureFixedIngestJobs failed for ${slot.hour}:${String(slot.minute).padStart(2, '0')}:`,
        e.message
      )
    }
  }
}

// Wipe all cron-job.org jobs and recreate the 5 fixed ingest slots from scratch.
// Called from the admin UI "Sync cron jobs" button.
async function resetFixedIngestJobs() {
  const token = process.env.DISCOVER_TOKEN
  if (!token) throw new Error('DISCOVER_TOKEN not set')

  const db = getDb()

  // Delete every live job
  const liveRes = await listJobs().catch(() => null)
  const allJobIds = (liveRes?.jobs ?? []).map((j) => j.jobId)
  await Promise.allSettled(allJobIds.map((id) => deleteJob(id)))

  // Clear all stored job IDs (fixed + legacy discovery)
  const allKeys = [...FIXED_INGEST_SLOTS.map((s) => s.key), 'discover_job_id']
  for (const key of allKeys) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
  }

  // Create the 5 fixed jobs
  let created = 0
  for (const slot of FIXED_INGEST_SLOTS) {
    try {
      const result = await createFixedIngestJob(slot.hour, slot.minute, token)
      if (result?.jobId) {
        db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
          slot.key,
          String(result.jobId)
        )
        console.log(
          `[scheduler] sync: created fixed ingest job ${slot.hour}:${String(slot.minute).padStart(2, '0')} → #${result.jobId}`
        )
        created++
      } else if (result !== null) {
        console.warn(
          `[scheduler] sync: no jobId for ${slot.hour}:${String(slot.minute).padStart(2, '0')} — account limit?`
        )
      }
    } catch (e) {
      console.error(
        `[scheduler] sync: failed ${slot.hour}:${String(slot.minute).padStart(2, '0')}:`,
        e.message
      )
    }
  }

  return { deleted: allJobIds.length, created }
}

// Rate-limited startup discovery: skip if last run was within the past hour to avoid
// hammering the API every time Fly.io cold-starts the machine.
async function startupDiscover() {
  const db = getDb()
  const row = db.prepare(`SELECT MAX(discovered_at) AS last FROM scheduled_fixtures`).get()
  if (row?.last) {
    const elapsedMs = Date.now() - new Date(row.last).getTime()
    const ONE_HOUR_MS = 3600_000
    if (elapsedMs < ONE_HOUR_MS) {
      const ageMin = Math.round(elapsedMs / 60_000)
      console.log(`[scheduler] startup discover skipped — last run was ${ageMin}min ago (< 1h)`)
      return
    }
  }
  return discoverFixtures()
}

// node-cron schedules — safety net for long-running instances. Primary trigger for
// ingest cycles is the cron-job.org fixed daily webhooks (which also wake Fly when sleeping).
// Daily at 06:00 Europe/London — discover new fixtures
cron.schedule(
  '0 6 * * *',
  () =>
    discoverFixtures().catch((e) => {
      console.error('[scheduler] discover error:', e)
      require('./utils/notifications')
        .notifyServiceAlert({ message: 'Fixture discovery failed', detail: e.message })
        .catch(() => {})
    }),
  { timezone: 'Europe/London' }
)

// Every 30 minutes — ingest any matches past their threshold
cron.schedule(
  '*/30 * * * *',
  () =>
    processPendingIngests().catch((e) => {
      console.error('[scheduler] ingest error:', e)
      require('./utils/notifications')
        .notifyServiceAlert({ message: 'Scheduler ingest cycle failed', detail: e.message })
        .catch(() => {})
    }),
  { timezone: 'Europe/London' }
)

// Daily at 09:00 Europe/London — digest of pending access requests older than 7 days
cron.schedule(
  '0 9 * * *',
  () =>
    require('./utils/notifications')
      .notifyPendingRequestsDigest()
      .catch((e) => console.error('[scheduler] digest error:', e.message)),
  { timezone: 'Europe/London' }
)

// Run once on startup
startupDiscover().catch((e) => console.error('[scheduler] startup discover error:', e))
processPendingIngests().catch((e) => console.error('[scheduler] startup ingest error:', e))
ensureFixedIngestJobs().catch((e) => console.error('[scheduler] ensureFixedIngestJobs error:', e))

module.exports = {
  discoverFixtures,
  processPendingIngests,
  queueTeamSeasons,
  rescanAllSeasons,
  resetFixedIngestJobs,
  FIXED_INGEST_SLOTS
}
