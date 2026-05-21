const cron = require('node-cron')
const { fetchFixtureList } = require('./utils/resultsvault')
const { getDb } = require('./db/schema')

const DELAY_H = parseFloat(process.env.AUTO_INGEST_DELAY_HOURS || '4')

function addHours(isoStr, h) {
  const d = new Date(isoStr)
  d.setTime(d.getTime() + h * 3600_000)
  return d.toISOString()
}

async function discoverFixtures() {
  const db = getDb()
  const teams = db.prepare('SELECT team_id, season_id FROM watched_teams').all()
  if (!teams.length) return 0

  const insert = db.prepare(`
    INSERT OR IGNORE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, ground)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  let total = 0

  for (const { team_id, season_id } of teams) {
    try {
      const fixtures = await fetchFixtureList(team_id, season_id)
      for (const f of fixtures) {
        const info = insert.run(f.playCricketId, team_id, season_id, f.matchDateIso, addHours(f.matchDateIso, DELAY_H), now, f.homeTeam, f.awayTeam, f.ground)
        if (info.changes) total++
      }
    } catch (e) {
      console.error(`[scheduler] discoverFixtures failed for team ${team_id}:`, e.message)
    }
  }

  if (total) console.log(`[scheduler] discoverFixtures: ${total} new fixture(s) queued`)
  return total
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

  const { ingestMatch } = require('./db/ingestMatch')

  for (const row of pending) {
    db.prepare(`UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`)
      .run(row.play_cricket_id)
    try {
      await ingestMatch(row.play_cricket_id)
      db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=? WHERE play_cricket_id=?`)
        .run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] ingested fixture ${row.play_cricket_id}`)
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
