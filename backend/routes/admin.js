const express = require('express')
const router  = express.Router()
const { apiLimiter } = require('../middleware/rateLimit')
router.use(apiLimiter)
const multer  = require('multer')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { clerkClient } = require('@clerk/express')
const { getDb, closeDb, DB_PATH } = require('../db/schema')
const { resolveTeamSeasons } = require('../utils/resultsvault')
const { ingestMatch } = require('../db/ingestMatch')
const { isWhccTeam, whccFixtureWhere, whccCol } = require('../utils/db')
const { getAuthContext, requireSuperAdmin } = require('../middleware/auth')

// Lazy getter so scheduler.js (which requires admin.js indirectly) is only loaded after boot
function getScheduler() { return require('../scheduler') }

// Verified auth context (attached by attachAuthContext middleware).
function getAdminMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, isClubAdmin: ctx.isClubAdmin, groups: ctx.groups }
}
function canManageUsers(req) { const m = getAdminMeta(req); return m.isSuperAdmin || m.isClubAdmin }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

// GET /api/admin/ingests — audit log of all ingest operations
router.get('/ingests', (req, res) => {
  const rows = getDb().prepare(`
    SELECT i.*, f.home_team, f.away_team, f.match_date
    FROM ingests i
    LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
    ORDER BY i.ingested_at DESC
    LIMIT 100
  `).all()
  res.json(rows)
})

// GET /api/admin/export — hot backup of the SQLite database (super-admin only)
router.get('/export', requireSuperAdmin, async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {})) // nosemgrep: tmpPath is os.tmpdir()+timestamp, not user input
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/import — replace the database with an uploaded .db file (super-admin only)
router.post('/import', requireSuperAdmin, upload.single('db'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate SQLite magic bytes
  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    closeDb()
    // Remove WAL and shared-memory files so the new DB starts clean
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix) } catch (_) {} // eslint-disable-line no-empty -- nosemgrep: suffix is hardcoded
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    getDb() // reopen and run migrations
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/player/:id — update display_name and/or is_sub flag
router.patch('/player/:id', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  if (!playerId) return res.status(400).json({ error: 'Invalid player id' })

  // Player may have deliveries but no players row (synthetic ID deleted by a name-merge,
  // or play-cricket exported a negative ID for an unregistered player). Create a stub so
  // display_name and is_sub can be saved and the player shows up in the stats table.
  const exists = db.prepare('SELECT 1 FROM players WHERE player_id = ?').get(playerId)
  if (!exists) {
    const fixture = db.prepare(`
      SELECT f.home_team, f.away_team FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN fixtures f ON f.fixture_id = i.fixture_id
      WHERE d.batter_id = ? OR d.bowler_id = ?
      LIMIT 1
    `).get(playerId, playerId)
    const team = fixture
      ? (isWhccTeam(fixture.home_team) ? fixture.home_team : isWhccTeam(fixture.away_team) ? fixture.away_team : null)
      : null
    db.prepare(`INSERT OR IGNORE INTO players (player_id, name, team) VALUES (?, ?, ?)`)
      .run(playerId, `Player #${playerId}`, team)
  }

  if ('display_name' in req.body) {
    const val = typeof req.body.display_name === 'string' ? req.body.display_name.trim() || null : null
    db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(val, playerId)
  }
  if ('is_sub' in req.body) {
    db.prepare(`UPDATE players SET is_sub = ? WHERE player_id = ?`).run(req.body.is_sub ? 1 : 0, playerId)
  }
  res.json({ ok: true })
})

// GET /api/admin/duplicate-players — groups of WHCC players sharing the same effective name.
// Scoped to WHCC players (team IS NULL or matches our club markers) — we never want to merge
// opposition players who happen to share a name with one of ours.
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
  const isWhcc = `(p.team IS NULL OR ${whccCol('p.team')})`
  const rows = db.prepare(`
    SELECT p.player_id, COALESCE(p.display_name, p.name) AS effective_name,
      p.name, p.display_name, p.team,
      COUNT(DISTINCT d.pid) AS appearances
    FROM players p
    LEFT JOIN (
      SELECT batter_id AS pid, result_id FROM deliveries WHERE batter_id IS NOT NULL
      UNION ALL
      SELECT bowler_id AS pid, result_id FROM deliveries WHERE bowler_id IS NOT NULL
    ) d ON d.pid = p.player_id
    WHERE lower(COALESCE(p.display_name, p.name)) IN (
      SELECT lower(COALESCE(display_name, name))
      FROM players
      WHERE COALESCE(display_name, name) IS NOT NULL AND COALESCE(display_name, name) != ''
        AND COALESCE(ignore_flag, 0) = 0
        AND (team IS NULL OR ${whccCol('team')})
      GROUP BY lower(COALESCE(display_name, name))
      HAVING COUNT(*) > 1
    )
    AND COALESCE(p.ignore_flag, 0) = 0
    AND ${isWhcc}
    GROUP BY p.player_id
    ORDER BY lower(effective_name), appearances DESC
  `).all()

  const groups = {}
  for (const r of rows) {
    const key = r.effective_name.toLowerCase()
    if (!groups[key]) groups[key] = { name: r.effective_name, players: [] }
    groups[key].players.push({ player_id: r.player_id, name: r.name, display_name: r.display_name, team: r.team, appearances: r.appearances })
  }
  res.json(Object.values(groups))
})

// GET /api/admin/matches-missing-team — ingested fixtures with no fixture_seasons row
// (no team/season is watching them, so they're invisible to all scoped users)
router.get('/matches-missing-team', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso
    FROM fixtures f
    WHERE f.fixture_id NOT LIKE 'manual-%'
      AND ${whccFixtureWhere()}
      AND NOT EXISTS (SELECT 1 FROM fixture_seasons fs WHERE fs.fixture_id = f.fixture_id)
    ORDER BY f.match_date_iso DESC
    LIMIT 100
  `).all()
  res.json(rows)
})

// GET /api/admin/matches-missing-roles — ball-by-ball fixtures missing captain or WK
router.get('/matches-missing-roles', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.match_date,
      CASE WHEN (
        EXISTS(SELECT 1 FROM player_flags pf WHERE pf.fixture_id = f.fixture_id AND pf.is_captain = 1)
        OR EXISTS(SELECT 1 FROM match_captains mc WHERE mc.fixture_id = f.fixture_id)
      ) THEN 1 ELSE 0 END AS has_captain,
      CASE WHEN (
        EXISTS(SELECT 1 FROM wk_assignments wa WHERE wa.fixture_id = f.fixture_id)
        OR EXISTS(SELECT 1 FROM player_flags pf WHERE pf.fixture_id = f.fixture_id AND pf.is_wk = 1)
      ) THEN 1 ELSE 0 END AS has_wk
    FROM fixtures f
    JOIN innings i ON i.fixture_id = f.fixture_id
    WHERE f.fixture_id NOT LIKE 'manual-%'
      AND ${whccFixtureWhere()}
    GROUP BY f.fixture_id
    HAVING has_captain = 0 OR has_wk = 0
    ORDER BY f.match_date DESC
  `).all()
  res.json(rows)
})

// POST /api/admin/merge-players — reassign all data from dropId to keepId, then delete dropId
router.post('/merge-players', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const keep = parseInt(req.body?.keepId, 10)
  const drop = parseInt(req.body?.dropId, 10)
  if (!keep || !drop || keep === drop) return res.status(400).json({ error: 'Invalid player IDs' })

  const db = getDb()
  try {
    db.transaction(() => {
      // deliveries — four columns reference player IDs
      db.prepare(`UPDATE deliveries SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET batter_id_ns = ? WHERE batter_id_ns = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET dismissed_batter_id = ? WHERE dismissed_batter_id = ?`).run(keep, drop)
      // dismissals
      db.prepare(`UPDATE dismissals SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET fielder_id = ? WHERE fielder_id = ?`).run(keep, drop)
      // tables with unique constraints on (fixture, player): skip conflicts, then clean up
      for (const tbl of ['player_flags', 'manual_batting', 'manual_bowling']) {
        db.prepare(`UPDATE OR IGNORE ${tbl} SET player_id = ? WHERE player_id = ?`).run(keep, drop)
        db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(drop)
      }
      // no unique constraint on player_id alone in these tables
      db.prepare(`UPDATE wk_assignments SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE wk_errors SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE match_captains SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      // remove the duplicate player record
      db.prepare(`DELETE FROM players WHERE player_id = ?`).run(drop)
    })()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/fetch-match — ingest a match directly from play-cricket by URL
router.post('/fetch-match', async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url required' })

  const m = url.match(/\/results\/(\d+)/)
  if (!m) return res.status(400).json({ error: 'Could not find fixture ID in URL' })
  const playCricketId = m[1]

  try {
    let userName = null
    if (req.auth?.userId && process.env.CLERK_SECRET_KEY) {
      try {
        const user = await clerkClient.users.getUser(req.auth.userId)
        userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      } catch (_) {} // eslint-disable-line no-empty
    }
    const { fixtureId, rvMatchId, results, matchMeta, maxOvers, associated } = await ingestMatch(playCricketId, { userId: req.auth?.userId ?? null, userName })
    res.json({
      ok: true,
      playCricketId,
      fixtureId,
      rvMatchId,
      results,
      maxOvers: maxOvers ?? null,
      associated: associated ?? null,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null,
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/associate-match — manually link a fixture to a watched team+season
// Body: { fixture_id, team_id, season_id }
router.post('/associate-match', (req, res) => {
  const { fixture_id, team_id, season_id } = req.body || {}
  if (!fixture_id || !team_id || !season_id) return res.status(400).json({ error: 'fixture_id, team_id and season_id required' })

  const db = getDb()
  const fixture = db.prepare('SELECT play_cricket_id, home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?').get(String(fixture_id))
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  if (!fixture.play_cricket_id) return res.status(400).json({ error: 'Fixture has no play_cricket_id — cannot associate' })

  db.prepare(`
    INSERT OR REPLACE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)
  `).run(
    parseInt(fixture.play_cricket_id),
    parseInt(team_id), parseInt(season_id),
    fixture.match_date_iso, fixture.match_date_iso,
    new Date().toISOString(),
    fixture.home_team, fixture.away_team,
    new Date().toISOString(),
  )
  res.json({ ok: true })
})

// GET /api/admin/teams — all known team+season combos for access group assignment.
// Combines watched_teams (current) with scheduled_fixtures history so past seasons
// remain assignable even after the watched_team entry is removed.
router.get('/teams', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      wt.id,
      t.team_id,
      t.season_id,
      COALESCE(wt.label, 'Team ' || t.team_id)                              AS label,
      COALESCE(wt.year, substr(MIN(sf.match_date_iso), 1, 4))               AS year
    FROM (
      SELECT team_id, season_id FROM scheduled_fixtures
      UNION
      SELECT team_id, season_id FROM watched_teams
    ) t
    LEFT JOIN watched_teams      wt ON wt.team_id = t.team_id AND wt.season_id = t.season_id
    LEFT JOIN scheduled_fixtures sf ON sf.team_id = t.team_id AND sf.season_id = t.season_id
    GROUP BY t.team_id, t.season_id
    ORDER BY year DESC, label
  `).all()
  res.json(rows)
})

// (Past-season registration is gone — adding a team via POST /scheduler/teams now resolves
// and registers every season the team played from 2025 onward in one action.)

// --- Scheduler endpoints ---

// GET /api/admin/scheduler/status
router.get('/scheduler/status', (req, res) => {
  const db = getDb()
  const teams = db.prepare('SELECT * FROM watched_teams ORDER BY added_at DESC').all()
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM scheduled_fixtures GROUP BY status
  `).all().reduce((acc, r) => { acc[r.status] = r.n; return acc }, {})
  // Per (team_id, season_id): status counts + last DONE match date so the UI shows the most
  // recently ingested match, not the furthest-future scheduled one.
  const byTeam = db.prepare(`
    SELECT team_id, season_id, status, COUNT(*) AS n,
      CASE WHEN status = 'done' THEN MAX(match_date_iso) ELSE NULL END AS last_match_date
    FROM scheduled_fixtures GROUP BY team_id, season_id, status
  `).all()
  const recent = db.prepare(`
    SELECT * FROM scheduled_fixtures WHERE status = 'done' ORDER BY match_date_iso DESC LIMIT 20
  `).all()
  res.json({ teams, queue: { pending: counts.pending || 0, done: counts.done || 0, failed: counts.failed || 0 }, byTeam, recent })
})

// POST /api/admin/scheduler/teams — add a team by pasting any Play Cricket URL for it.
// Body: { url }. Only the team_id is used — the season_id in the URL is ignored. Every season
// the team played from 2025 onward is resolved and registered as its own watched_teams row;
// past results queue immediately (staggered) and the live season is set up for ongoing discovery.
router.post('/scheduler/teams', async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url required' })

  let teamId
  try {
    teamId = new URL(url).searchParams.get('team_id')
  } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' })
  }
  if (!teamId) return res.status(400).json({ error: 'URL must contain a team_id param' })

  try {
    const seasons = await resolveTeamSeasons(teamId)
    if (!seasons.length) {
      return res.status(404).json({ error: 'No fixtures found for this team in 2025 or later' })
    }
    const db = getDb()
    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO watched_teams (team_id, season_id, label, year, added_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(team_id, season_id) DO UPDATE SET label = excluded.label, year = excluded.year
    `)
    for (const s of seasons) {
      upsert.run(parseInt(teamId), parseInt(s.season_id), s.label, s.year, now)
    }
    const rows = db.prepare('SELECT * FROM watched_teams WHERE team_id = ? ORDER BY year').all(parseInt(teamId))

    // Queue every resolved season's fixtures now (covers past seasons, which the daily
    // discoverFixtures skips), then ingest anything already due.
    getScheduler().queueTeamSeasons(teamId, seasons)
    getScheduler().processPendingIngests()
      .catch(e => console.error('[scheduler] post-add ingest error:', e))

    res.json({
      ok: true,
      teams: rows,
      resolved: seasons.map(s => ({ season_id: parseInt(s.season_id), year: s.year, label: s.label, fixtures: s.fixtures.length })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/scheduler/teams/:id
router.delete('/scheduler/teams/:id', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  db.prepare('DELETE FROM watched_teams WHERE id = ?').run(parseInt(req.params.id))
  res.json({ ok: true })
})

// POST /api/admin/scheduler/discover — manually trigger fixture discovery
router.post('/scheduler/discover', async (req, res) => {
  try {
    const added = await getScheduler().discoverFixtures()
    res.json({ ok: true, added: added || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/scheduler/rescan — re-resolve & re-queue every watched team's seasons,
// backfilling past-season fixtures that the daily discovery skips. Then ingest anything due.
router.post('/scheduler/rescan', async (req, res) => {
  try {
    const added = await getScheduler().rescanAllSeasons()
    getScheduler().processPendingIngests().catch(e => console.error('[scheduler] post-rescan ingest error:', e))
    res.json({ ok: true, added: added || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/scheduler/cron-jobs — fetch live job state from cron-job.org for pending fixtures
router.get('/scheduler/cron-jobs', async (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT play_cricket_id, cron_job_id, home_team, away_team, match_date_iso, ingest_after, attempt_count
    FROM scheduled_fixtures
    WHERE cron_job_id IS NOT NULL AND status = 'pending'
    ORDER BY ingest_after
  `).all()
  if (!rows.length) return res.json([])

  const { getJob } = require('../utils/cronJobOrg')
  const isIngested = db.prepare(`SELECT 1 FROM fixtures WHERE play_cricket_id = ? LIMIT 1`)

  // Build the live-state row for one scheduled fixture. Read-only: stale rows whose match is
  // already ingested are simply omitted from the table — the 30-min poller (processPendingIngests)
  // marks them done, so this GET handler performs no database mutation.
  async function liveStateFor(r) {
    const base = {
      play_cricket_id: r.play_cricket_id,
      cron_job_id: r.cron_job_id,
      home_team: r.home_team,
      away_team: r.away_team,
      match_date_iso: r.match_date_iso,
      ingest_after: r.ingest_after,
      attempt_count: r.attempt_count,
    }
    const liveJob = (await getJob(r.cron_job_id))?.job ?? null
    if (liveJob) {
      return { ...base, job_url: liveJob.url ?? null, next_execution: liveJob.nextExecution ?? null, enabled: liveJob.enabled ?? null, job_missing: false }
    }
    // Job gone (fired+deleted or expired). Already ingested → omit; otherwise show as expired.
    if (isIngested.get(String(r.play_cricket_id))) return null
    return { ...base, job_url: null, next_execution: null, enabled: null, job_missing: true }
  }

  const results = await Promise.allSettled(rows.map(liveStateFor))
  res.json(results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean))
})

// GET /api/admin/scheduler/past-pending — pending fixtures whose ingest_after is in the past,
// i.e. they should have been ingested already. Excludes matches already in fixtures table.
router.get('/scheduler/past-pending', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT sf.play_cricket_id, sf.home_team, sf.away_team, sf.match_date_iso, sf.ingest_after,
      sf.attempt_count, sf.error_msg
    FROM scheduled_fixtures sf
    WHERE sf.status = 'pending'
      AND sf.ingest_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND NOT EXISTS (SELECT 1 FROM fixtures f WHERE f.play_cricket_id = CAST(sf.play_cricket_id AS TEXT))
    ORDER BY sf.match_date_iso ASC
  `).all()
  res.json(rows)
})

// POST /api/admin/scheduler/process-now — immediately run the pending-ingest loop
router.post('/scheduler/process-now', (req, res) => {
  res.json({ ok: true, message: 'Processing pending ingests in background…' })
  // Fire-and-forget: don't await so the HTTP response returns immediately
  getScheduler().processPendingIngests().catch(e =>
    console.error('[admin] process-now error:', e.message)
  )
})

// POST /api/admin/scheduler/ingest-one/:playCricketId — ingest a single scheduled fixture now.
// Waits for the result and returns success/error so the UI can give immediate feedback.
router.post('/scheduler/ingest-one/:playCricketId', async (req, res) => {
  const db = getDb()
  const pcId = String(req.params.playCricketId).trim()
  if (!pcId) return res.status(400).json({ error: 'playCricketId required' })

  const row = db.prepare(`SELECT * FROM scheduled_fixtures WHERE play_cricket_id = ?`).get(pcId)
  if (!row) return res.status(404).json({ error: 'Fixture not found in scheduled_fixtures' })

  // If it was already ingested, just mark done and return.
  const alreadyDone = db.prepare(`SELECT fixture_id FROM fixtures WHERE play_cricket_id = ? LIMIT 1`).get(pcId)
  if (alreadyDone) {
    db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=COALESCE(ingested_at,?) WHERE play_cricket_id=?`)
      .run(new Date().toISOString(), pcId)
    return res.json({ ok: true, fixtureId: alreadyDone.fixture_id, alreadyDone: true })
  }

  db.prepare(`UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?`).run(pcId)
  try {
    const { ingestMatch } = require('../db/ingestMatch')
    const { notifyMatchIngested } = require('../utils/matchSummary')
    const { deleteJob } = require('../utils/cronJobOrg')
    const { fixtureId } = await ingestMatch(pcId)
    db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=? WHERE play_cricket_id=?`)
      .run(new Date().toISOString(), pcId)
    if (row.cron_job_id) deleteJob(row.cron_job_id).catch(() => {})
    notifyMatchIngested(fixtureId).catch(() => {})
    res.json({ ok: true, fixtureId })
  } catch (e) {
    db.prepare(`UPDATE scheduled_fixtures SET status='failed', error_msg=? WHERE play_cricket_id=?`)
      .run(e.message, pcId)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/scheduler/reingest-candidates — fixtures that may have missed retired-not-out data.
// Heuristic: has ball-by-ball data; a batter stopped mid-innings, was never dismissed, and has no
// Retired row in the dismissals table (i.e. ingested before the v5.6.4 retirement fix).
router.get('/scheduler/reingest-candidates', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    WITH last_over AS (
      SELECT result_id, MAX(over_no) AS final_over FROM deliveries GROUP BY result_id
    ),
    batter_last_over AS (
      SELECT d.result_id, d.batter_id, MAX(d.over_no) AS last_over_faced
      FROM deliveries d GROUP BY d.result_id, d.batter_id
    ),
    dismissed AS (
      SELECT result_id, dismissed_batter_id FROM deliveries
      WHERE dismissed_batter_id IS NOT NULL GROUP BY result_id, dismissed_batter_id
    )
    SELECT DISTINCT f.fixture_id, f.home_team, f.away_team, f.match_date_iso,
      f.play_cricket_id
    FROM batter_last_over bl
    JOIN last_over lo ON lo.result_id = bl.result_id
    JOIN innings i ON i.result_id = bl.result_id
    JOIN fixtures f ON f.fixture_id = i.fixture_id
    JOIN players p ON p.player_id = bl.batter_id
    WHERE bl.last_over_faced < lo.final_over
      AND NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.result_id = bl.result_id AND d.dismissed_batter_id = bl.batter_id)
      AND NOT EXISTS (
        SELECT 1 FROM dismissals dis
        WHERE dis.fixture_id = i.fixture_id AND dis.innings_order = i.innings_order
          AND dis.batter_id = bl.batter_id AND dis.method = 'Retired'
      )
      AND f.play_cricket_id IS NOT NULL
      AND p.name NOT LIKE '%:%' AND p.name NOT LIKE 'Unknown%'
      AND p.name NOT LIKE 'Player #%' AND length(p.name) > 4
    ORDER BY f.match_date_iso DESC
  `).all()
  res.json(rows)
})

// POST /api/admin/scheduler/reingest-bulk — re-queue fixtures for re-ingest.
// Body: { ids: [fixture_id, …] }  (fixture_ids from the candidates endpoint).
// Resets each to pending with a staggered ingest_after so they fire over the next few minutes.
router.post('/scheduler/reingest-bulk', (req, res) => {
  const db = getDb()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : []
  if (!ids.length) return res.status(400).json({ error: 'ids required' })

  const nowMs = Date.now()
  const STAGGER_MS = 30_000 // 30 s between each re-ingest
  let queued = 0

  const findSf  = db.prepare(`SELECT play_cricket_id FROM scheduled_fixtures WHERE play_cricket_id = (SELECT play_cricket_id FROM fixtures WHERE fixture_id = ?)`)
  const resetSf = db.prepare(`UPDATE scheduled_fixtures SET status='pending', ingest_after=?, attempt_count=0, error_msg=NULL WHERE play_cricket_id=?`)

  db.transaction(() => {
    ids.forEach((fixtureId, i) => {
      const sf = findSf.get(String(fixtureId))
      if (!sf) return
      const after = new Date(nowMs + i * STAGGER_MS).toISOString()
      const info = resetSf.run(after, sf.play_cricket_id)
      if (info.changes) queued++
    })
  })()

  res.json({ ok: true, queued })

  // Trigger immediate processing in background after a short delay to let the response send
  setTimeout(() => {
    getScheduler().processPendingIngests().catch(e =>
      console.error('[admin] reingest-bulk process error:', e.message)
    )
  }, 500)
})

// POST /api/admin/scheduler/retry — reset failed rows back to pending
router.post('/scheduler/retry', (req, res) => {
  const db = getDb()
  const info = db.prepare(`UPDATE scheduled_fixtures SET status='pending', error_msg=NULL, attempt_count=0 WHERE status='failed'`).run()
  res.json({ ok: true, reset: info.changes })
})

// GET /api/admin/scheduler/stale — pending >7 days or failed fixtures that may need ignoring
router.get('/scheduler/stale', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT play_cricket_id, team_id, season_id, home_team, away_team,
      match_date_iso, ingest_after, attempt_count, status, error_msg
    FROM scheduled_fixtures
    WHERE status IN ('pending', 'failed')
      AND (
        status = 'failed'
        OR ingest_after < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
      )
    ORDER BY ingest_after ASC
    LIMIT 500
  `).all()
  res.json(rows)
})

// POST /api/admin/scheduler/ignore — mark a fixture as ignored (won't be retried)
router.post('/scheduler/ignore', (req, res) => {
  const db = getDb()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (!ids.length) return res.status(400).json({ error: 'ids array required' })
  const ph = ids.map(() => '?').join(',') // ph contains only '?' placeholders. nosemgrep
  const info = db.prepare(
    `UPDATE scheduled_fixtures SET status='ignored', error_msg=NULL WHERE play_cricket_id IN (${ph}) AND status IN ('pending', 'failed')` // nosemgrep
  ).run(...ids)
  res.json({ ok: true, ignored: info.changes })
})

// GET /api/admin/manual-matches — list of manually-entered fixtures for admin tab
router.get('/manual-matches', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso,
      f.competition, f.result, f.format,
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0) AS bat_rows,
      (SELECT COUNT(*) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) AS bowl_rows
    FROM fixtures f
    WHERE f.fixture_id LIKE 'manual-%'
    ORDER BY f.match_date_iso DESC
    LIMIT 200
  `).all()
  res.json(rows)
})

// GET /api/admin/match/:id — raw ingestion truth for a fixture (super-admin panel)
router.get('/match/:id', (req, res) => {
  const db = getDb()
  const fixtureId = req.params.id

  const fixture = db.prepare(`
    SELECT fixture_id, play_cricket_id, home_team, away_team, match_date_iso,
      format, competition, ground, result, starting_score, max_overs
    FROM fixtures WHERE fixture_id = ?
  `).get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  const scheduled = fixture.play_cricket_id
    ? db.prepare(`
        SELECT sf.play_cricket_id, sf.team_id, sf.season_id, sf.status,
          sf.cron_job_id, sf.attempt_count, sf.ingest_after, sf.ingested_at,
          sf.error_msg, sf.discovered_at,
          wt.label AS team_label, wt.year AS season_year
        FROM scheduled_fixtures sf
        LEFT JOIN watched_teams wt ON wt.team_id = sf.team_id AND wt.season_id = sf.season_id
        WHERE sf.play_cricket_id = ?
      `).all(parseInt(fixture.play_cricket_id))
    : []

  const ingests = db.prepare(`
    SELECT id, ingested_at, clerk_user_id, clerk_user_name, source_files, row_counts
    FROM ingests WHERE fixture_id = ? ORDER BY ingested_at DESC
  `).all(fixtureId)

  const associations = db.prepare(`
    SELECT fs.team_id, fs.season_id, wt.label AS team_label, wt.year AS season_year
    FROM fixture_seasons fs
    LEFT JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
    WHERE fs.fixture_id = ?
  `).all(fixtureId)

  res.json({ fixture, scheduled, ingests, associations })
})

// DELETE /api/admin/match/:id — remove a fixture and all associated data (super-admin only)
router.delete('/match/:id', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  if (!fixtureId) return res.status(400).json({ error: 'fixture_id required' })
  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM wk_errors          WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM wk_assignments     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM match_captains     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM player_flags       WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM dismissals         WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_batting     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_bowling     WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_extras      WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM manual_fielding    WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM ingests            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id = ?)`).run(fixtureId)
      db.prepare(`DELETE FROM fixture_seasons   WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM innings            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM fixtures           WHERE fixture_id = ?`).run(fixtureId)
    })()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── User access management ────────────────────────────────────────────────────
// Requires CLERK_SECRET_KEY — no-op in local dev without it.

// GET /api/admin/users — list Clerk users (super admin sees all; club admin sees all but can only change access groups for their teams)
router.get('/users', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.json([])
  try {
    const { data: users } = await clerkClient.users.getUserList({ limit: 500 })
    if (users.length >= 500) console.warn('[admin] getUserList hit limit of 500 — some users may be missing')
    res.json(users.map(u => ({
      id:           u.id,
      email:        u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName:    u.firstName,
      lastName:     u.lastName,
      canUpload:    u.publicMetadata?.canUpload    === true,
      isSuperAdmin: u.publicMetadata?.isSuperAdmin === true,
      isClubAdmin:  u.publicMetadata?.isClubAdmin  === true,
      accessGroups: u.publicMetadata?.accessGroups ?? [],
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/users/:userId — update a user's access metadata
// Body: { canUpload?: bool, isSuperAdmin?: bool, isClubAdmin?: bool, accessGroups?: [{team_id, season_id}] }
router.patch('/users/:userId', async (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({ error: 'Clerk not configured' })

  const { isSuperAdmin: callerIsSuper, groups: callerGroups } = getAdminMeta(req)
  const { userId } = req.params
  // Club admins can only change accessGroups, and only for teams they manage
  const allowed = callerIsSuper ? ['canUpload', 'isSuperAdmin', 'isClubAdmin', 'accessGroups'] : ['accessGroups']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' })
  if (updates.accessGroups !== undefined) {
    if (!Array.isArray(updates.accessGroups) ||
        !updates.accessGroups.every(g => g.team_id !== null && g.season_id !== null)) {
      return res.status(400).json({ error: 'accessGroups must be an array of {team_id, season_id}' })
    }
    updates.accessGroups = updates.accessGroups.map(g => ({ team_id: Number(g.team_id), season_id: Number(g.season_id) }))
    // Club admins can only grant access to teams they manage — merge instead of replace
    if (!callerIsSuper && callerGroups.length > 0) {
      const user = await clerkClient.users.getUser(userId)
      const existing = Array.isArray(user.publicMetadata?.accessGroups) ? user.publicMetadata.accessGroups : []
      // Keep any groups the club admin doesn't manage, merge in their changes
      const unmanaged = existing.filter(g => !callerGroups.some(cg => cg.team_id === g.team_id && cg.season_id === g.season_id))
      updates.accessGroups = [...unmanaged, ...updates.accessGroups.filter(g => callerGroups.some(cg => cg.team_id === g.team_id && cg.season_id === g.season_id))]
    }
  }
  try {
    const user = await clerkClient.users.getUser(userId)
    const merged = { ...user.publicMetadata, ...updates }
    await clerkClient.users.updateUserMetadata(userId, { publicMetadata: merged })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/my-groups — returns the requesting user's access groups enriched with labels.
// Super admins see all watched_teams (useful for admin filtering too).
// Regular users see only their own JWT groups resolved against watched_teams.
router.get('/my-groups', (req, res) => {
  const db = getDb()
  const { isSuperAdmin, groups } = getAdminMeta(req)

  let rows
  if (isSuperAdmin) {
    rows = db.prepare(`
      SELECT team_id, season_id, label, year
      FROM watched_teams ORDER BY year DESC, label ASC
    `).all()
  } else {
    if (!groups.length) return res.json([])
    const clauses = groups.map(() => '(wt.team_id = ? AND wt.season_id = ?)').join(' OR ')
    const params  = groups.flatMap(g => [Number(g.team_id), Number(g.season_id)])
    rows = db.prepare(`
      SELECT wt.team_id, wt.season_id, wt.label, wt.year
      FROM watched_teams wt
      WHERE ${clauses}
      ORDER BY wt.year DESC, wt.label ASC
    `).all(...params)
  }

  res.json(rows.map(r => ({
    team_id:   r.team_id,
    season_id: r.season_id,
    label:     r.label,
    year:      r.year ?? null,
    display:   r.year ? `${r.label} ${r.year}` : r.label,
  })))
})

module.exports = router
