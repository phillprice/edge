// One-time cleanup + backfill for the team/season redesign.
//
// Two problems this fixes:
//   A) The old discovery used the Play Cricket Fixture tab, which ignores season_id and always
//      returns the live season. So a team registered under a past season (e.g. team 377146 /
//      season 258 = 2025) accumulated rows whose match_date year != the season's year (2026
//      fixtures filed under the 2025 season).
//   B) The old add-flow stored only the single season from the pasted URL, so most teams have
//      just one year even though their team_id played in multiple seasons (2025 AND 2026).
//
// This script:
//   1. Builds the club-wide season_id -> year map.
//   2. Deletes mis-filed scheduled_fixtures rows (match year != season year), best-effort
//      removing the associated cron-job.org jobs.
//   3. Re-resolves EVERY distinct team_id in watched_teams from scratch (resolveTeamSeasons),
//      upserts a watched_teams row per real season, and queues each season's fixtures. This
//      backfills the missing years so every team shows its full 2025->now set.
//
// Safe to re-run (idempotent: re-queue uses INSERT OR IGNORE). Usage:
//   node scripts/cleanup-misfiled-fixtures.js
//   DB_PATH=/path/to/cricket.db node scripts/cleanup-misfiled-fixtures.js

const { getDb } = require('../db/schema')
const { fetchSeasonMap, resolveTeamSeasons } = require('../utils/resultsvault')
const { queueTeamSeasons } = require('../scheduler')
const { deleteJob } = require('../utils/cronJobOrg')

async function main() {
  const db = getDb()
  const seasonMap = await fetchSeasonMap() // { season_id: 'YYYY' }

  // 1. Find mis-filed rows: match year != the season's year.
  const all = db.prepare(`
    SELECT play_cricket_id, team_id, season_id, substr(match_date_iso, 1, 4) AS match_year, cron_job_id
    FROM scheduled_fixtures
  `).all()

  const misfiled = all.filter(r => {
    const seasonYear = seasonMap[String(r.season_id)]
    return seasonYear && r.match_year && r.match_year !== seasonYear
  })

  console.log(`Found ${misfiled.length} mis-filed fixture row(s) of ${all.length} total.`)

  const affectedTeams = new Set()
  const del = db.prepare('DELETE FROM scheduled_fixtures WHERE play_cricket_id = ?')
  for (const r of misfiled) {
    del.run(r.play_cricket_id)
    affectedTeams.add(String(r.team_id))
    if (r.cron_job_id) deleteJob(r.cron_job_id).catch(() => {})
    console.log(`  deleted fixture ${r.play_cricket_id} (match ${r.match_year} under season ${r.season_id}=${seasonMap[String(r.season_id)]})`)
  }

  // 2. Re-resolve EVERY distinct team in watched_teams (not just the mis-filed ones) so every
  //    team_id is backfilled to its full set of seasons.
  for (const r of db.prepare('SELECT DISTINCT team_id FROM watched_teams').all()) {
    affectedTeams.add(String(r.team_id))
  }

  if (!affectedTeams.size) {
    console.log('No teams to re-resolve. Done.')
    return
  }

  const upsert = db.prepare(`
    INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(team_id, season_id) DO UPDATE SET label = excluded.label, year = excluded.year
  `)
  const now = new Date().toISOString()

  for (const teamId of affectedTeams) {
    try {
      const seasons = await resolveTeamSeasons(teamId)
      for (const s of seasons) {
        upsert.run(parseInt(teamId), parseInt(s.season_id), s.label, s.year, now)
      }
      const queued = queueTeamSeasons(teamId, seasons)
      console.log(`  re-resolved team ${teamId}: ${seasons.map(s => `${s.year}(${s.fixtures.length})`).join(', ')} — ${queued} newly queued`)
    } catch (e) {
      console.error(`  failed to re-resolve team ${teamId}: ${e.message}`)
    }
  }

  console.log('Cleanup complete.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
