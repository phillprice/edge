const cron = require('node-cron')
const { randomUUID } = require('crypto')
const { fetchFixtureList } = require('./utils/resultsvault')
const { getDb } = require('./db/schema')
const { notifyMatchIngested } = require('./utils/matchSummary')
const { createIngestJob, deleteJob } = require('./utils/cronJobOrg')

const DELAY_H = parseFloat(process.env.AUTO_INGEST_DELAY_HOURS || '4')

function addHours(isoStr, h) {
  const d = new Date(isoStr)
  d.setTime(d.getTime() + h * 3600_000)
  return d.toISOString()
}

async function discoverFixtures() {
  const db = getDb()
  const teams = db.prepare('SELECT team_id, season_id, year FROM watched_teams').all()
  if (!teams.length) return 0

  const insert = db.prepare(`
    INSERT OR IGNORE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, ground)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  let total = 0

  for (const { team_id, season_id, year } of teams) {
    try {
      const fixtures = await fetchFixtureList(team_id, season_id, year)
      for (const f of fixtures) {
        const ingestAfter = addHours(f.matchDateIso, DELAY_H)
        const info = insert.run(f.playCricketId, team_id, season_id, f.matchDateIso, ingestAfter, now, f.homeTeam, f.awayTeam, f.ground)
        if (info.changes) {
          total++
          const token = randomUUID()
          db.prepare(`UPDATE scheduled_fixtures SET ingest_token = ? WHERE play_cricket_id = ?`).run(token, f.playCricketId)
          createIngestJob(f.playCricketId, ingestAfter, token).then(result => {
            if (result?.jobId) {
              db.prepare(`UPDATE scheduled_fixtures SET cron_job_id = ? WHERE play_cricket_id = ?`).run(result.jobId, f.playCricketId)
              console.log(`[scheduler] cron-job.org #${result.jobId} created for fixture ${f.playCricketId}`)
            }
          }).catch(e => console.error(`[scheduler] cron-job.org create failed for ${f.playCricketId}:`, e.message))
        }
      }
    } catch (e) {
      console.error(`[scheduler] discoverFixtures failed for team ${team_id}:`, e.message)
    }
  }

  if (total) console.log(`[scheduler] discoverFixtures: ${total} new fixture(s) queued`)

  // Backfill cron jobs for any pending fixtures that pre-date this feature
  await backfillCronJobs(db)

  return total
}

async function backfillCronJobs(db) {
  const rows = db.prepare(`
    SELECT play_cricket_id, ingest_after FROM scheduled_fixtures
    WHERE status = 'pending' AND cron_job_id IS NULL
  `).all()
  if (!rows.length) return
  console.log(`[scheduler] backfill: creating cron jobs for ${rows.length} fixture(s)`)
  await Promise.allSettled(rows.map(async row => {
    const token = randomUUID()
    db.prepare(`UPDATE scheduled_fixtures SET ingest_token = ? WHERE play_cricket_id = ?`).run(token, row.play_cricket_id)
    try {
      const result = await createIngestJob(row.play_cricket_id, row.ingest_after, token)
      if (result?.jobId) {
        db.prepare(`UPDATE scheduled_fixtures SET cron_job_id = ? WHERE play_cricket_id = ?`).run(result.jobId, row.play_cricket_id)
        console.log(`[scheduler] backfill: cron-job.org #${result.jobId} created for fixture ${row.play_cricket_id}`)
      }
    } catch (e) {
      console.error(`[scheduler] backfill failed for ${row.play_cricket_id}:`, e.message)
    }
  }))
}

async function processPendingIngests() {
  const db = getDb()
  const pending = db.prepare(`
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= datetime('now')
      AND attempt_count < 5
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
      AND ingest_after <= datetime('now')
      AND attempt_count < 5
    ORDER BY ingest_after
  `).all()

  for (const row of stillPending) {
    db.prepare(`UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`)
      .run(row.play_cricket_id)
    try {
      const { fixtureId } = await ingestMatch(row.play_cricket_id)
      db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=?, ingest_token=NULL WHERE play_cricket_id=?`)
        .run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] ingested fixture ${row.play_cricket_id}`)
      notifyMatchIngested(fixtureId).catch(e => console.error('[scheduler] notify error:', e.message))
      if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
    } catch (e) {
      const exhausted = (row.attempt_count + 1) >= 5
      db.prepare(`UPDATE scheduled_fixtures SET status=?, error_msg=? WHERE play_cricket_id=?`)
        .run(exhausted ? 'failed' : 'pending', e.message, row.play_cricket_id)
      console.error(`[scheduler] failed fixture ${row.play_cricket_id}: ${e.message}`)
    }
  }
}

// Daily at 06:00 — discover new fixtures
cron.schedule('0 6 * * *', () => discoverFixtures().catch(e => console.error('[scheduler] discover error:', e)))

// Every 30 minutes — ingest any matches past their threshold
cron.schedule('*/30 * * * *', () => processPendingIngests().catch(e => console.error('[scheduler] ingest error:', e)))

// Run once on startup
discoverFixtures().catch(e => console.error('[scheduler] startup discover error:', e))
processPendingIngests().catch(e => console.error('[scheduler] startup ingest error:', e))

module.exports = { discoverFixtures, processPendingIngests }
