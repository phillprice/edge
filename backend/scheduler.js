const cron = require('node-cron')
const { randomUUID } = require('crypto')
const { fetchFixtureList, resolveTeamSeasons } = require('./utils/resultsvault')
const { getDb } = require('./db/schema')
const { notifyMatchIngested } = require('./utils/matchSummary')
const { createIngestJob, deleteJob } = require('./utils/cronJobOrg')

const DELAY_H = parseFloat(process.env.AUTO_INGEST_DELAY_HOURS || '4')

function addHours(isoStr, h) {
  const d = new Date(isoStr)
  d.setTime(d.getTime() + h * 3600_000)
  return d.toISOString()
}

// Spacing between staggered past-match ingest jobs (minutes).
// Keeps us well inside Play Cricket / ResultsVault rate limits.
const PAST_STAGGER_MIN = 2

// How many cron-job.org webhook jobs to keep active at once. Stays comfortably inside
// the free/entry tier limit. Override via CRON_JOB_WINDOW env var.
const CRON_JOB_WINDOW = parseInt(process.env.CRON_JOB_WINDOW || '5', 10)

// Insert scheduled_fixtures rows for one team/season's fixtures.
// Does NOT create cron-job.org jobs inline — topUpCronJobs() is called once at the
// end of each discovery/ingest pass to fill the rolling window.
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
  const nowMs  = Date.now()
  let added = 0
  for (const f of fixtures) {
    const naturalAfter = addHours(f.matchDateIso, DELAY_H)
    const isPast = new Date(naturalAfter) < new Date()
    const ingestAfter = isPast
      ? new Date(nowMs + (++stagger.n) * PAST_STAGGER_MIN * 60_000).toISOString()
      : naturalAfter
    const info = insert.run(f.playCricketId, team_id, season_id, f.matchDateIso, ingestAfter, nowIso, f.homeTeam, f.awayTeam, f.ground)
    if (info.changes) added++
  }
  return added
}

// Ensure the next CRON_JOB_WINDOW future fixtures all have active cron-job.org jobs.
// Called after discovery, after each ingest cycle, and from the webhook handler so that
// as jobs fire and are consumed, the window rolls forward automatically.
// Sequential (not parallel) to avoid hammering the cron-job.org API.
async function topUpCronJobs(db) {
  const activeCount = db.prepare(`
    SELECT COUNT(*) AS n FROM scheduled_fixtures
    WHERE status = 'pending' AND cron_job_id IS NOT NULL
      AND ingest_after > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).get().n

  const needed = CRON_JOB_WINDOW - activeCount
  if (needed <= 0) return 0

  const rows = db.prepare(`
    SELECT play_cricket_id, ingest_after FROM scheduled_fixtures
    WHERE status = 'pending' AND cron_job_id IS NULL
      AND ingest_after > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY ingest_after
    LIMIT ?
  `).all(needed)

  if (!rows.length) return 0

  let created = 0
  for (const row of rows) {
    const token = randomUUID()
    db.prepare(`UPDATE scheduled_fixtures SET ingest_token = ? WHERE play_cricket_id = ?`).run(token, row.play_cricket_id)
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await createIngestJob(row.play_cricket_id, row.ingest_after, token)
      if (result?.jobId) {
        db.prepare(`UPDATE scheduled_fixtures SET cron_job_id = ? WHERE play_cricket_id = ?`).run(result.jobId, row.play_cricket_id)
        console.log(`[scheduler] top-up: cron-job.org #${result.jobId} for fixture ${row.play_cricket_id} (${row.ingest_after.slice(0, 16)})`)
        created++
      } else {
        console.warn(`[scheduler] top-up: no jobId returned for fixture ${row.play_cricket_id} — account limit may be reached`)
        break // no point trying more if the API is refusing
      }
    } catch (e) {
      console.error('[scheduler] top-up failed for fixture', row.play_cricket_id, '-', e.message) // nosemgrep: play_cricket_id is an integer PK, not user input
      break
    }
  }
  if (created) console.log(`[scheduler] top-up: created ${created} cron job(s) (window now ${activeCount + created}/${CRON_JOB_WINDOW})`)
  return created
}

// Queue every season's fixtures for a freshly-added team, using the already-resolved
// resolveTeamSeasons() output so we don't re-fetch. Covers past seasons too (the daily
// discoverFixtures only re-scans current-year teams). Returns total rows queued.
function queueTeamSeasons(teamId, seasons) {
  const db = getDb()
  const stagger = { n: 0 }
  let total = 0
  for (const s of seasons) {
    total += queueFixtures(db, parseInt(teamId), parseInt(s.season_id), s.fixtures, stagger)
  }
  if (total) console.log(`[scheduler] queued ${total} fixture(s) for team ${teamId} across ${seasons.length} season(s)`)
  return total
}

// Re-resolve every watched team's seasons and re-queue their fixtures. Backfills past seasons
// that the daily discoverFixtures skips (it only re-scans the current year). Safe to run
// repeatedly — queueFixtures uses INSERT OR IGNORE, so already-queued matches are untouched.
// Returns the number of newly-queued fixtures.
async function rescanAllSeasons() {
  const db = getDb()
  const teamIds = db.prepare('SELECT DISTINCT team_id FROM watched_teams').all().map(r => r.team_id)
  let total = 0
  for (const teamId of teamIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
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
  if (total) console.log(`[scheduler] rescanAllSeasons queued ${total} new fixture(s) across ${teamIds.length} team(s)`)
  return total
}

async function discoverFixtures() {
  const db = getDb()
  // Only re-scan teams for the current calendar year or later. Past seasons are complete —
  // their fixtures are queued once at add-time (via queueTeamSeasons), so re-scanning them
  // daily just wastes API calls and re-inserts done rows. Null-year rows included as fallback.
  const currentYear = String(new Date().getFullYear())
  const teams = db.prepare(
    'SELECT team_id, season_id, year FROM watched_teams WHERE year IS NULL OR year >= ?'
  ).all(currentYear)

  const stagger = { n: 0 }
  let total = 0
  for (const { team_id, season_id, year } of teams) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const fixtures = await fetchFixtureList(team_id, season_id, year)
      total += queueFixtures(db, team_id, season_id, fixtures, stagger)
    } catch (e) {
      console.error(`[scheduler] discoverFixtures failed for team ${team_id}:`, e.message)
    }
  }

  if (total) console.log(`[scheduler] discoverFixtures: ${total} new fixture(s) queued`)

  // Fill the rolling cron-job.org window after new fixtures are queued
  await topUpCronJobs(db)

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
  const pending = db.prepare(`
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND attempt_count < ${MAX_ATTEMPTS}
    ORDER BY ingest_after
  `).all()

  if (!pending.length) return

  // Clean up any rows where the match was already manually ingested
  for (const row of pending) {
    const alreadyIngested = db.prepare(
      `SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`
    ).get(String(row.play_cricket_id))
    if (alreadyIngested) {
      db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=COALESCE(ingested_at,?), ingest_token=NULL WHERE play_cricket_id=?`)
        .run(new Date().toISOString(), row.play_cricket_id)
      if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
      console.log(`[scheduler] fixture ${row.play_cricket_id} already ingested — marked done, cron job deleted`)
    }
  }

  const { ingestMatch } = require('./db/ingestMatch')

  // Re-query after cleanup so we don't attempt already-done rows
  const stillPending = db.prepare(`
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND attempt_count < ${MAX_ATTEMPTS}
    ORDER BY ingest_after
  `).all()

  for (const row of stillPending) {
    db.prepare(`UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`)
      .run(row.play_cricket_id)
    try {
      // eslint-disable-next-line no-await-in-loop
      const { fixtureId } = await ingestMatch(row.play_cricket_id)
      db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=?, ingest_token=NULL WHERE play_cricket_id=?`)
        .run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] ingested fixture ${row.play_cricket_id}`)
      notifyMatchIngested(fixtureId).catch(e => console.error('[scheduler] notify error:', e.message))
      if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
    } catch (e) {
      const newAttemptCount = row.attempt_count + 1
      const exhausted = newAttemptCount >= MAX_ATTEMPTS
      if (exhausted) {
        db.prepare(`UPDATE scheduled_fixtures SET status='failed', error_msg=? WHERE play_cricket_id=?`)
          .run(e.message, row.play_cricket_id)
        console.error(`[scheduler] failed fixture ${row.play_cricket_id} (gave up after ${newAttemptCount} attempts): ${e.message}`)
      } else {
        // Schedule the next retry with exponential backoff
        const delayMin = BACKOFF_MINUTES[newAttemptCount - 1]
        const nextAfter = new Date(Date.now() + delayMin * 60_000).toISOString()
        db.prepare(`UPDATE scheduled_fixtures SET status='pending', error_msg=?, ingest_after=? WHERE play_cricket_id=?`)
          .run(e.message, nextAfter, row.play_cricket_id)
        console.warn(`[scheduler] fixture ${row.play_cricket_id} attempt ${newAttemptCount} failed; retrying in ${delayMin}min: ${e.message}`)
      }
    }
  }

  // Roll the cron-job.org window forward after consuming jobs in this pass
  await topUpCronJobs(db)
}

// Daily at 06:00 Europe/London — discover new fixtures
cron.schedule('0 6 * * *', () => discoverFixtures().catch(e => {
  console.error('[scheduler] discover error:', e)
  require('./utils/notifications').notifyServiceAlert({ message: 'Fixture discovery failed', detail: e.message }).catch(() => {})
}), { timezone: 'Europe/London' })

// Every 30 minutes — ingest any matches past their threshold
cron.schedule('*/30 * * * *', () => processPendingIngests().catch(e => {
  console.error('[scheduler] ingest error:', e)
  require('./utils/notifications').notifyServiceAlert({ message: 'Scheduler ingest cycle failed', detail: e.message }).catch(() => {})
}), { timezone: 'Europe/London' })

// Daily at 09:00 Europe/London — digest of pending access requests older than 7 days
cron.schedule('0 9 * * *', () =>
  require('./utils/notifications').notifyPendingRequestsDigest().catch(e => console.error('[scheduler] digest error:', e.message))
, { timezone: 'Europe/London' })

// Run once on startup
discoverFixtures().catch(e => console.error('[scheduler] startup discover error:', e))
processPendingIngests().catch(e => console.error('[scheduler] startup ingest error:', e))

module.exports = { discoverFixtures, processPendingIngests, queueTeamSeasons, rescanAllSeasons, topUpCronJobs }
