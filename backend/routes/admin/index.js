'use strict'

const express = require('express')
const router = express.Router()
const multer = require('multer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { clerkClient } = require('@clerk/express')
const { randomBytes } = require('crypto')
const { getDb, closeDb, DB_PATH } = require('../../db/schema')
const { ingestMatch } = require('../../db/ingestMatch')
const { isOurTeam, ourFixtureWhere, ourCol } = require('../../utils/db')
const { getAuthContext, requireSuperAdmin } = require('../../middleware/auth')
const { validateBody, validateParams, z } = require('../../utils/validate')
const schedulerRouter = require('./scheduler')
const { VALID_TAGS, syncFixtureTags, tagsFromCompetition } = require('../../utils/tags')
const { parseScorecard } = require('../../utils/pdfScorecard')

function getAdminMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, isClubAdmin: ctx.isClubAdmin, groups: ctx.groups }
}
function canManageUsers(req) {
  const m = getAdminMeta(req)
  return m.isSuperAdmin || m.isClubAdmin
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

// GET /api/admin/ingests
router.get('/ingests', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.*, f.home_team, f.away_team, f.match_date
      FROM ingests i
      LEFT JOIN fixtures f ON f.fixture_id = i.fixture_id
      ORDER BY i.ingested_at DESC
      LIMIT 100`
    )
    .all()
  res.json(rows)
})

// GET /api/admin/export
router.get('/export', requireSuperAdmin, async (req, res, next) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {})) // nosemgrep: tmpPath is os.tmpdir()+timestamp, not user input
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/import
router.post('/import', requireSuperAdmin, upload.single('db'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    closeDb()
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suffix)
      } catch (_) {}
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    getDb()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

const playerIdParams = z.object({ id: z.coerce.number().int() })
const patchPlayerSchema = z
  .object({
    display_name: z.string().optional(),
    is_sub: z.boolean().optional(),
    ignore_flag: z.boolean().optional()
  })
  .refine((b) => 'display_name' in b || 'is_sub' in b || 'ignore_flag' in b, {
    message: 'At least one of display_name, is_sub, or ignore_flag is required'
  })

// PATCH /api/admin/player/:id
router.patch(
  '/player/:id',
  validateParams(playerIdParams),
  validateBody(patchPlayerSchema),
  (req, res) => {
    const db = getDb()
    const playerId = req.params.id

    const exists = db.prepare('SELECT 1 FROM players WHERE player_id = ?').get(playerId)
    if (!exists) {
      const fixture = db
        .prepare(
          `SELECT f.home_team, f.away_team FROM deliveries d
          JOIN innings i ON i.result_id = d.result_id
          JOIN fixtures f ON f.fixture_id = i.fixture_id
          WHERE d.batter_id = ? OR d.bowler_id = ?
          LIMIT 1`
        )
        .get(playerId, playerId)
      const team = fixture
        ? isOurTeam(fixture.home_team)
          ? fixture.home_team
          : isOurTeam(fixture.away_team)
            ? fixture.away_team
            : null
        : null
      db.prepare(`INSERT OR IGNORE INTO players (player_id, name, team) VALUES (?, ?, ?)`).run(
        playerId,
        `Player #${playerId}`,
        team
      )
    }

    if ('display_name' in req.body) {
      const val =
        typeof req.body.display_name === 'string' ? req.body.display_name.trim() || null : null
      db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(val, playerId)
    }
    if ('is_sub' in req.body) {
      db.prepare(`UPDATE players SET is_sub = ? WHERE player_id = ?`).run(
        req.body.is_sub ? 1 : 0,
        playerId
      )
    }
    if ('ignore_flag' in req.body) {
      db.prepare(`UPDATE players SET ignore_flag = ? WHERE player_id = ?`).run(
        req.body.ignore_flag ? 1 : 0,
        playerId
      )
    }
    res.json({ ok: true })
  }
)

// GET /api/admin/duplicate-players
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
  const isOurs = `(p.team IS NULL OR ${ourCol('p.team')})`
  const rows = db
    .prepare(
      `SELECT p.player_id, COALESCE(p.display_name, p.name) AS effective_name,
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
          AND (team IS NULL OR ${ourCol('team')})
        GROUP BY lower(COALESCE(display_name, name))
        HAVING COUNT(*) > 1
      )
      AND COALESCE(p.ignore_flag, 0) = 0
      AND ${isOurs}
      GROUP BY p.player_id
      ORDER BY lower(effective_name), appearances DESC`
    )
    .all()

  const groups = {}
  for (const r of rows) {
    const key = r.effective_name.toLowerCase()
    if (!groups[key]) groups[key] = { name: r.effective_name, players: [] }
    groups[key].players.push({
      player_id: r.player_id,
      name: r.name,
      display_name: r.display_name,
      team: r.team,
      appearances: r.appearances
    })
  }
  res.json(Object.values(groups))
})

// GET /api/admin/matches-missing-team
router.get('/matches-missing-team', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso
      FROM fixtures f
      WHERE f.fixture_id NOT LIKE 'manual-%'
        AND ${ourFixtureWhere()}
        AND NOT EXISTS (SELECT 1 FROM fixture_seasons fs WHERE fs.fixture_id = f.fixture_id)
      ORDER BY f.match_date_iso DESC
      LIMIT 100`
    )
    .all()
  res.json(rows)
})

// GET /api/admin/matches-missing-roles
router.get('/matches-missing-roles', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date,
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
        AND ${ourFixtureWhere()}
      GROUP BY f.fixture_id
      HAVING has_captain = 0 OR has_wk = 0
      ORDER BY f.match_date DESC`
    )
    .all()
  res.json(rows)
})

const mergePlayersSchema = z.object({
  keepId: z.number().int(),
  dropId: z.number().int()
})

// POST /api/admin/merge-players
router.post('/merge-players', validateBody(mergePlayersSchema), (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const keep = req.body.keepId
  const drop = req.body.dropId
  if (keep === drop) return res.status(400).json({ error: 'Invalid player IDs' })

  const db = getDb()
  try {
    db.transaction(() => {
      db.prepare(`UPDATE deliveries SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET batter_id_ns = ? WHERE batter_id_ns = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE deliveries SET dismissed_batter_id = ? WHERE dismissed_batter_id = ?`).run(
        keep,
        drop
      )
      db.prepare(`UPDATE dismissals SET batter_id = ? WHERE batter_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET bowler_id = ? WHERE bowler_id = ?`).run(keep, drop)
      db.prepare(`UPDATE dismissals SET fielder_id = ? WHERE fielder_id = ?`).run(keep, drop)
      for (const tbl of ['player_flags', 'manual_batting', 'manual_bowling']) {
        db.prepare(`UPDATE OR IGNORE ${tbl} SET player_id = ? WHERE player_id = ?`).run(keep, drop)
        db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(drop)
      }
      db.prepare(`UPDATE wk_assignments SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE wk_errors SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`UPDATE match_captains SET player_id = ? WHERE player_id = ?`).run(keep, drop)
      db.prepare(`DELETE FROM players WHERE player_id = ?`).run(drop)
    })()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/fetch-match
router.post('/fetch-match', async (req, res, next) => {
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
      } catch (_) {}
    }
    const { fixtureId, rvMatchId, results, matchMeta, maxOvers, associated } = await ingestMatch(
      playCricketId,
      { userId: req.auth?.userId ?? null, userName, clubId: getAuthContext(req).clubId ?? null }
    )
    res.json({
      ok: true,
      playCricketId,
      fixtureId,
      rvMatchId,
      results,
      maxOvers: maxOvers ?? null,
      associated: associated ?? null,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    next(err)
  }
})

// POST /api/admin/associate-match
router.post('/associate-match', (req, res) => {
  const { fixture_id, team_id, season_id } = req.body || {}
  if (!fixture_id || !team_id || !season_id)
    return res.status(400).json({ error: 'fixture_id, team_id and season_id required' })

  const db = getDb()
  const fixture = db
    .prepare(
      'SELECT play_cricket_id, home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?'
    )
    .get(String(fixture_id))
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  if (!fixture.play_cricket_id)
    return res.status(400).json({ error: 'Fixture has no play_cricket_id — cannot associate' })

  db.prepare(
    `INSERT OR REPLACE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`
  ).run(
    parseInt(fixture.play_cricket_id),
    parseInt(team_id),
    parseInt(season_id),
    fixture.match_date_iso,
    fixture.match_date_iso,
    new Date().toISOString(),
    fixture.home_team,
    fixture.away_team,
    new Date().toISOString()
  )
  res.json({ ok: true })
})

// GET /api/admin/teams
router.get('/teams', (req, res) => {
  const ctx = getAuthContext(req)
  const db = getDb()
  const clubWhere = ctx.isSuperAdmin ? '1=1' : 'club_id = ?'
  const params = ctx.isSuperAdmin ? [] : [ctx.clubId, ctx.clubId]
  const rows = db
    .prepare(
      `SELECT
        wt.id,
        t.team_id,
        t.season_id,
        COALESCE(wt.label, 'Team ' || t.team_id)                              AS label,
        COALESCE(wt.year, substr(MIN(sf.match_date_iso), 1, 4))               AS year
      FROM (
        SELECT team_id, season_id FROM scheduled_fixtures WHERE ${clubWhere}
        UNION
        SELECT team_id, season_id FROM watched_teams WHERE ${clubWhere}
      ) t
      LEFT JOIN watched_teams      wt ON wt.team_id = t.team_id AND wt.season_id = t.season_id
      LEFT JOIN scheduled_fixtures sf ON sf.team_id = t.team_id AND sf.season_id = t.season_id
      GROUP BY t.team_id, t.season_id
      ORDER BY year DESC, label`
    )
    .all(...params)
  res.json(rows)
})

// Mount scheduler sub-router
router.use('/scheduler', schedulerRouter)

// GET /api/admin/manual-matches
router.get('/manual-matches', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.match_date_iso,
        f.competition, f.result, f.format, f.match_type,
        (SELECT GROUP_CONCAT(tag) FROM fixture_tags WHERE fixture_id = f.fixture_id) AS tags_csv,
        (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0) AS bat_rows,
        (SELECT COUNT(*) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) AS bowl_rows
      FROM fixtures f
      WHERE f.fixture_id LIKE 'manual-%'
      ORDER BY f.match_date_iso DESC
      LIMIT 200`
    )
    .all()
  res.json(
    rows.map((r) => ({
      ...r,
      tags: r.tags_csv ? r.tags_csv.split(',') : [r.match_type || 'league'],
      tags_csv: undefined
    }))
  )
})

// GET /api/admin/match/:id
router.get('/match/:id', (req, res) => {
  const db = getDb()
  const fixtureId = req.params.id

  const fixture = db
    .prepare(
      `SELECT fixture_id, play_cricket_id, home_team, away_team, match_date_iso,
        format, match_type, competition, ground, result, starting_score, max_overs,
        (SELECT GROUP_CONCAT(tag) FROM fixture_tags WHERE fixture_id = ?) AS tags_csv
      FROM fixtures WHERE fixture_id = ?`
    )
    .get(fixtureId, fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
  fixture.tags = fixture.tags_csv ? fixture.tags_csv.split(',') : [fixture.match_type || 'league']
  delete fixture.tags_csv

  const scheduled = fixture.play_cricket_id
    ? db
        .prepare(
          `SELECT sf.play_cricket_id, sf.team_id, sf.season_id, sf.status,
            sf.cron_job_id, sf.attempt_count, sf.ingest_after, sf.ingested_at,
            sf.error_msg, sf.discovered_at,
            wt.label AS team_label, wt.year AS season_year
          FROM scheduled_fixtures sf
          LEFT JOIN watched_teams wt ON wt.team_id = sf.team_id AND wt.season_id = sf.season_id
          WHERE sf.play_cricket_id = ?`
        )
        .all(parseInt(fixture.play_cricket_id))
    : []

  const ingests = db
    .prepare(
      `SELECT id, ingested_at, clerk_user_id, clerk_user_name, source_files, row_counts
      FROM ingests WHERE fixture_id = ? ORDER BY ingested_at DESC`
    )
    .all(fixtureId)

  const associations = db
    .prepare(
      `SELECT fs.team_id, fs.season_id, wt.label AS team_label, wt.year AS season_year
      FROM fixture_seasons fs
      LEFT JOIN watched_teams wt ON wt.team_id = fs.team_id AND wt.season_id = fs.season_id
      WHERE fs.fixture_id = ?`
    )
    .all(fixtureId)

  res.json({ fixture, scheduled, ingests, associations })
})

// DELETE /api/admin/match/:id
router.delete('/match/:id', (req, res, next) => {
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
      db.prepare(
        `DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id = ?)`
      ).run(fixtureId)
      db.prepare(`DELETE FROM fixture_seasons   WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM innings            WHERE fixture_id = ?`).run(fixtureId)
      db.prepare(`DELETE FROM fixtures           WHERE fixture_id = ?`).run(fixtureId)
    })()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/match/:id/recalculate-score
// Clears the scraped home_score/away_score (which may be league points, not runs)
// and recomputes from delivery totals via backfillFixtureSummary.
router.post('/match/:id/recalculate-score', (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  if (!fixtureId) return res.status(400).json({ error: 'fixture_id required' })
  try {
    db.prepare(
      `UPDATE fixtures SET home_score = NULL, away_score = NULL,
       home_wickets = NULL, away_wickets = NULL, home_overs = NULL, away_overs = NULL
       WHERE fixture_id = ?`
    ).run(fixtureId)
    const { backfillFixtureSummary } = require('../../utils/matchSummary')
    const { clubId } = getAuthContext(req)
    const updated = backfillFixtureSummary(db, fixtureId, clubId ?? null)
    if (!updated)
      return res.status(422).json({
        error: 'Could not compute score from deliveries — need at least 2 innings with data'
      })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/admin/match/:id/tags  (also accepts legacy match_type for backwards compat)
router.patch('/match/:id/type', (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const db = getDb()
  const fixtureId = req.params.id
  // Accept either tags[] (new) or match_type string (legacy)
  let tags = req.body?.tags
  if (!tags) {
    const normalised = (req.body?.match_type || '').toLowerCase()
    if (!VALID_TAGS.includes(normalised))
      return res.status(400).json({ error: `match_type must be one of: ${VALID_TAGS.join(', ')}` })
    tags = [normalised]
  }
  if (!Array.isArray(tags) || tags.length > VALID_TAGS.length)
    return res
      .status(400)
      .json({ error: `tags must be an array of up to ${VALID_TAGS.length} items` })
  const invalid = tags.filter((t) => !VALID_TAGS.includes(t))
  if (invalid.length) return res.status(400).json({ error: `Invalid tags: ${invalid.join(', ')}` })
  try {
    const fixture = db
      .prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?')
      .get(fixtureId)
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' })
    syncFixtureTags(db, fixtureId, tags)
    res.json({ ok: true, tags })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.json([])
  const ctx = getAuthContext(req)
  try {
    const { data: users } = await clerkClient.users.getUserList({ limit: 500 })
    if (users.length >= 500)
      console.warn('[admin] getUserList hit limit of 500 — some users may be missing')
    const mapped = users.map((u) => ({
      id: u.id,
      email: u.emailAddresses?.[0]?.emailAddress ?? null,
      firstName: u.firstName,
      lastName: u.lastName,
      canUpload: u.publicMetadata?.canUpload === true,
      isSuperAdmin: u.publicMetadata?.isSuperAdmin === true,
      isClubAdmin: u.publicMetadata?.isClubAdmin === true,
      accessGroups: u.publicMetadata?.accessGroups ?? [],
      clubId: u.publicMetadata?.clubId ?? null
    }))
    // Super admins see all users; club admins see only their club's users
    const filtered = ctx.isSuperAdmin ? mapped : mapped.filter((u) => u.clubId === ctx.clubId)
    res.json(filtered)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/admin/users/:userId
router.patch('/users/:userId', async (req, res, next) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  if (!process.env.CLERK_SECRET_KEY) return res.status(503).json({ error: 'Clerk not configured' })

  const { isSuperAdmin: callerIsSuper, groups: callerGroups } = getAdminMeta(req)
  const { userId } = req.params
  const allowed = callerIsSuper
    ? ['canUpload', 'isSuperAdmin', 'isClubAdmin', 'accessGroups']
    : ['accessGroups']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No valid fields to update' })
  if (updates.accessGroups !== undefined) {
    if (
      !Array.isArray(updates.accessGroups) ||
      !updates.accessGroups.every((g) => g.team_id !== null && g.season_id !== null)
    ) {
      return res
        .status(400)
        .json({ error: 'accessGroups must be an array of {team_id, season_id}' })
    }
    updates.accessGroups = updates.accessGroups.map((g) => ({
      team_id: Number(g.team_id),
      season_id: Number(g.season_id)
    }))
    if (!callerIsSuper && callerGroups.length > 0) {
      const user = await clerkClient.users.getUser(userId)
      const existing = Array.isArray(user.publicMetadata?.accessGroups)
        ? user.publicMetadata.accessGroups
        : []
      const unmanaged = existing.filter(
        (g) => !callerGroups.some((cg) => cg.team_id === g.team_id && cg.season_id === g.season_id)
      )
      updates.accessGroups = [
        ...unmanaged,
        ...updates.accessGroups.filter((g) =>
          callerGroups.some((cg) => cg.team_id === g.team_id && cg.season_id === g.season_id)
        )
      ]
    }
  }
  try {
    const user = await clerkClient.users.getUser(userId)
    const merged = { ...user.publicMetadata, ...updates }
    await clerkClient.users.updateUserMetadata(userId, { publicMetadata: merged })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/my-groups
router.get('/my-groups', (req, res) => {
  const db = getDb()
  const { isSuperAdmin, groups } = getAdminMeta(req)

  let rows
  if (isSuperAdmin) {
    rows = db
      .prepare(
        `SELECT team_id, season_id, label, year
        FROM watched_teams ORDER BY year DESC, label ASC`
      )
      .all()
  } else {
    if (!groups.length) return res.json([])
    const clauses = groups.map(() => '(wt.team_id = ? AND wt.season_id = ?)').join(' OR ')
    const params = groups.flatMap((g) => [Number(g.team_id), Number(g.season_id)])
    rows = db
      .prepare(
        `SELECT wt.team_id, wt.season_id, wt.label, wt.year
        FROM watched_teams wt
        WHERE ${clauses}
        ORDER BY wt.year DESC, wt.label ASC`
      )
      .all(...params)
  }

  res.json(
    rows.map((r) => ({
      team_id: r.team_id,
      season_id: r.season_id,
      label: r.label,
      year: r.year ?? null,
      display: r.year ? `${r.label} ${r.year}` : r.label
    }))
  )
})

// ── Scorecard PDF import ──────────────────────────────────────────────────────

// Normalise a name for comparison: collapse whitespace, strip dots from single-letter initials
// e.g. "L.  Price" → "l price",  "D. Cottrell" → "d cottrell"
function normaliseName(s) {
  return (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Za-z])\.(\s|$)/g, '$1$2')
    .toLowerCase()
}

function fuzzyNameMatch(a, b) {
  if (!a || !b) return false
  const al = normaliseName(a)
  const bl = normaliseName(b)
  if (al === bl) return true
  const ap = al.split(' ')
  const bp = bl.split(' ')
  // Must have forename+surname on both sides and surnames must agree
  if (ap.length < 2 || bp.length < 2 || ap[ap.length - 1] !== bp[bp.length - 1]) return false
  // initial ↔ full forename: "D Cottrell" ↔ "Dylan Cottrell"
  if (ap[0].length === 1) return bp[0].startsWith(ap[0])
  if (bp[0].length === 1) return ap[0].startsWith(bp[0])
  return false
}

// Look up a bowler id from bowlerMap by exact key then fuzzy name match.
// Handles PDF sections using different name formats (e.g. "D Cottrell" vs "Dylan Cottrell").
function bowlerIdFromMap(bowlerMap, name) {
  if (!name) return null
  const exact = bowlerMap[normaliseName(name)]
  if (exact) return exact
  const entry = Object.entries(bowlerMap).find(([k]) => fuzzyNameMatch(name, k))
  return entry ? entry[1] : null
}

// Expand an abbreviated name (e.g. "L Price") using full names found elsewhere in the same
// scorecard. Returns the expanded name only when exactly one unambiguous match exists.
function expandFromScorecard(name, scorecardNames) {
  const norm = normaliseName(name)
  const parts = norm.split(' ')
  if (parts.length < 2 || parts[0].length !== 1) return name
  const initial = parts[0]
  const surname = parts[parts.length - 1]
  const matches = scorecardNames.filter((n) => {
    const np = normaliseName(n).split(' ')
    return (
      np.length >= 2 &&
      np[np.length - 1] === surname &&
      np[0].length > 1 &&
      np[0].startsWith(initial) &&
      normaliseName(n) !== norm
    )
  })
  return matches.length === 1 ? matches[0] : name
}

function resolvePlayer(db, name, scorecardNames = []) {
  const expanded = scorecardNames.length ? expandFromScorecard(name, scorecardNames) : name
  const t = (expanded || '').trim()
  if (!t) return null
  // Exact or display_name match (also try normalised form to catch "L. Price" → "L Price")
  const norm = normaliseName(t)
  const exact = db
    .prepare(
      `SELECT player_id, COALESCE(display_name, name) AS dn FROM players
       WHERE name = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE
          OR name = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE
       LIMIT 1`
    )
    .get(t, t, norm, norm)
  if (exact) return { player_id: exact.player_id, matched: true }

  // Fuzzy match — pre-filter by surname so we only scan rows that could match.
  // fuzzyNameMatch requires identical surnames, so `LIKE '% surname'` is a safe pre-filter.
  const normParts = norm.split(' ')
  const surname = normParts[normParts.length - 1]
  const candidates = db
    .prepare(
      `SELECT player_id, COALESCE(display_name, name) AS dn FROM players
       WHERE lower(COALESCE(display_name, name)) LIKE ? COLLATE NOCASE
          OR lower(COALESCE(display_name, name)) = ? COLLATE NOCASE`
    )
    .all(`% ${surname}`, surname)
  const fuzzy = candidates.find((p) => fuzzyNameMatch(t, p.dn))
  if (fuzzy) return { player_id: fuzzy.player_id, matched: true, fuzzy: true }

  return { player_id: null, matched: false }
}

function findOrCreate(db, name, team) {
  const t = (name || '').trim()
  if (!t) return null
  const existing = db.prepare(`SELECT player_id FROM players WHERE name = ? COLLATE NOCASE`).get(t)
  if (existing) return existing.player_id
  const resolved = resolvePlayer(db, t)
  if (resolved?.player_id) return resolved.player_id
  return db.prepare(`INSERT INTO players (name, team) VALUES (?, ?)`).run(t, team || '')
    .lastInsertRowid
}

// ─── Scorecard-commit helpers ─────────────────────────────────────────────────

function insertManualBatting(db, fixtureId, inningsOrder, batting = [], ourTeam) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO manual_batting
     (fixture_id, innings_order, player_id, runs, balls, fours, sixes, not_out, how_out)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const b of batting) {
    if (b.did_not_bat) continue
    const pid = b.player_id ? Number(b.player_id) : findOrCreate(db, b.name, ourTeam)
    if (!pid) continue
    const { runs = 0, balls = 0, fours = 0, sixes = 0, not_out, how_out } = b
    stmt.run(
      fixtureId,
      inningsOrder,
      pid,
      runs,
      balls,
      fours,
      sixes,
      not_out ? 1 : 0,
      how_out || null
    )
  }
}

function insertManualBowling(db, fixtureId, inningsOrder, bowling = [], ourTeam) {
  const { oversToLegalBalls } = require('../../utils/cricket')
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO manual_bowling
     (fixture_id, innings_order, player_id, balls, maidens, runs, wickets, wides, no_balls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const b of bowling) {
    const pid = b.player_id ? Number(b.player_id) : findOrCreate(db, b.name, ourTeam)
    if (!pid) continue
    const { maidens = 0, runs = 0, wickets = 0, wides = 0, no_balls: noBalls = 0, overs = 0 } = b
    stmt.run(
      fixtureId,
      inningsOrder,
      pid,
      oversToLegalBalls(overs),
      maidens,
      runs,
      wickets,
      wides,
      noBalls
    )
  }
}

function buildBowlerMap(db, bowling, bowlingTeam) {
  const map = {}
  for (const b of bowling || []) {
    const pid = b.player_id ? Number(b.player_id) : findOrCreate(db, b.name, bowlingTeam)
    if (pid) map[normaliseName(b.name)] = pid
  }
  return map
}

function determineOpeningStriker(battingOrder, fow, batting) {
  let strikerIdx = 0
  let nonStrikerIdx = Math.min(1, battingOrder.length - 1)
  if (battingOrder.length >= 2 && fow.length > 0) {
    const firstFow = fow[0]
    const matchesIdx0 = fuzzyNameMatch(firstFow.batter_name, battingOrder[0].name)
    const matchesIdx1 = fuzzyNameMatch(firstFow.batter_name, battingOrder[1].name)
    if (matchesIdx1 && !matchesIdx0) {
      const batEntry = (batting || []).find((b) => fuzzyNameMatch(firstFow.batter_name, b.name))
      if (batEntry?.how_out !== 'run out') {
        strikerIdx = 1
        nonStrikerIdx = 0
      }
    }
  }
  return { strikerIdx, nonStrikerIdx }
}

function applyWicket(battingOrder, state, over, legalBalls, batting = []) {
  const fowEntry = state.fow.find((f) => f.over_no === over.over_no && f.ball_no === legalBalls)
  if (!fowEntry) {
    state.strikerIdx = state.nextBatterIdx++
    return
  }
  // fuzzyNameMatch handles undefined names gracefully (returns false)
  const fowMatchesST = fuzzyNameMatch(fowEntry.batter_name, battingOrder[state.strikerIdx]?.name)
  const fowMatchesNS = fuzzyNameMatch(fowEntry.batter_name, battingOrder[state.nonStrikerIdx]?.name)
  const batEntry = batting.find((b) => fuzzyNameMatch(fowEntry.batter_name, b.name))
  const nonStrikerDismissed = fowMatchesNS && !fowMatchesST
  if (nonStrikerDismissed && batEntry?.how_out === 'run out') {
    state.nonStrikerIdx = state.nextBatterIdx++
  } else if (nonStrikerDismissed) {
    ;[state.strikerIdx, state.nonStrikerIdx] = [state.nonStrikerIdx, state.strikerIdx]
    state.strikerIdx = state.nextBatterIdx++
  } else {
    state.strikerIdx = state.nextBatterIdx++
  }
  state.fow.splice(state.fow.indexOf(fowEntry), 1)
}

function insertDeliveries(db, resultId, inningsOrder, inn, bowlerMap) {
  const deliveryStmt = db.prepare(
    `INSERT OR IGNORE INTO deliveries
     (result_id, innings_number, over_no, ball_no, ball_no_disp,
      batter_id, batter_id_ns, bowler_id,
      runs_bat, runs_extra, extras_type, dismissed_batter_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const battingOrder = (inn.batting || [])
    .filter((b) => !b.did_not_bat)
    .map((b) => ({
      name: b.name,
      player_id: b.player_id ? Number(b.player_id) : findOrCreate(db, b.name, inn.batting_team),
      // balls the batter faced before retiring (null if they did not retire)
      retireBalls: b.how_out === 'retired' ? b.balls || 0 : null
    }))
  if (!battingOrder.length || !Object.keys(bowlerMap).length) return

  const state = {
    fow: (inn.fallOfWickets || []).slice(),
    nextBatterIdx: 2,
    ...determineOpeningStriker(battingOrder, (inn.fallOfWickets || []).slice(), inn.batting)
  }

  // Track legal balls faced per player so we can detect retirement when no R token appears
  // in the over-by-over (some PDF exporters omit it). Wides don't count toward a batter's
  // ball total, so we only increment on non-wide deliveries.
  const ballsFaced = {}

  for (const over of inn.overs || []) {
    let legalBalls = 0
    let ballDisp = 0
    const bowlerId = bowlerIdFromMap(bowlerMap, over.bowlers?.[0] || '')
    if (!bowlerId) continue

    for (const ball of over.balls) {
      ballDisp++
      const isWide = ball.extras_type === 2
      if (!isWide) legalBalls++

      const batter = battingOrder[state.strikerIdx]
      const nonStr = battingOrder[state.nonStrikerIdx]
      if (!batter?.player_id) continue

      deliveryStmt.run(
        resultId,
        inningsOrder,
        over.over_no,
        legalBalls,
        ballDisp,
        batter.player_id,
        nonStr?.player_id ?? null,
        bowlerId,
        ball.runs_bat ?? 0,
        ball.runs_extra ?? 0,
        ball.extras_type ?? null,
        ball.is_wicket ? batter.player_id : null
      )

      const facingPid = batter.player_id
      if (!isWide) ballsFaced[facingPid] = (ballsFaced[facingPid] || 0) + 1

      if (!isWide && (ball.runs_bat ?? 0) % 2 === 1) {
        ;[state.strikerIdx, state.nonStrikerIdx] = [state.nonStrikerIdx, state.strikerIdx]
      }

      if (ball.is_wicket) applyWicket(battingOrder, state, over, legalBalls, inn.batting)

      if (ball.retired && state.nextBatterIdx < battingOrder.length) {
        state.strikerIdx = state.nextBatterIdx++
      } else if (
        !isWide &&
        !ball.is_wicket &&
        !ball.retired &&
        state.nextBatterIdx < battingOrder.length
      ) {
        // Fallback for PDFs that omit the R token: retire a batter once the number of
        // legal balls they have faced as striker matches the batting-section ball count.
        // Ball-count is more reliable than run-count — runs can fire one ball early when
        // the last ball before retirement is scoring, misattributing subsequent deliveries.
        const facingEntry = battingOrder.find(
          (b) => b.player_id === facingPid && b.retireBalls !== null
        )
        if (facingEntry && ballsFaced[facingPid] >= facingEntry.retireBalls) {
          // After a possible odd-run swap the retiring batter may now be at either end.
          if (battingOrder[state.strikerIdx]?.player_id === facingPid) {
            state.strikerIdx = state.nextBatterIdx++
          } else {
            state.nonStrikerIdx = state.nextBatterIdx++
          }
        }
      }
    }

    ;[state.strikerIdx, state.nonStrikerIdx] = [state.nonStrikerIdx, state.strikerIdx]
  }
}

// Extract text from a PDF buffer via a temp file.
// tmpPath is always os.tmpdir()+timestamp — never user-controlled.
async function extractPdfText(buffer) {
  const { PDFParse } = require('pdf-parse')
  const tmpPath = path.join(os.tmpdir(), `scorecard-${Date.now()}.pdf`) // nosemgrep
  fs.writeFileSync(tmpPath, buffer) // nosemgrep
  try {
    const parser = new PDFParse({ url: tmpPath }) // nosemgrep
    await parser.load()
    const result = await parser.getText()
    return result.pages.map((p) => p.text).join('\n')
  } finally {
    fs.unlink(tmpPath, () => {}) // nosemgrep
  }
}

// POST /api/admin/import/scorecard-parse  (multer, returns JSON preview)
router.post('/import/scorecard-parse', upload.single('pdf'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const scorecard = parseScorecard(await extractPdfText(req.file.buffer))

    // Resolve player names against DB for preview, using cross-scorecard name expansion
    // so abbreviated names (e.g. "L Price") are resolved via full names found elsewhere
    // in the same PDF before falling back to the DB fuzzy match.
    const db = getDb()
    const allNames = [
      ...new Set(
        scorecard.innings.flatMap((inn) => [
          ...inn.batting.map((b) => b.name),
          ...inn.bowling.map((b) => b.name)
        ])
      )
    ]
    for (const inn of scorecard.innings) {
      for (const b of inn.batting) {
        Object.assign(b, resolvePlayer(db, b.name, allNames))
      }
      for (const b of inn.bowling) {
        Object.assign(b, resolvePlayer(db, b.name, allNames))
      }
    }

    res.json(scorecard)
  } catch (err) {
    next(err)
  }
})

function defaultTagsForMatch(match_type, competition) {
  if (match_type && VALID_TAGS.includes(match_type)) return [match_type]
  return tagsFromCompetition(competition) ?? ['friendly']
}

function resolveFixtureTags(tags, match_type, competition) {
  const resolved = tags ?? defaultTagsForMatch(match_type, competition)
  return { resolvedTags: resolved, primaryTag: resolved.find((t) => t !== 'league') ?? 'league' }
}

function ourInningsIndices(innings, our_team) {
  const batFirst = (innings[0]?.batting_team || '').toLowerCase()
  const isOursFirst = batFirst === (our_team || '').toLowerCase()
  return [isOursFirst ? 0 : 1, isOursFirst ? 1 : 0]
}

function insertScorecardInnings(db, fixture_id, innings, ourBatIdx, ourBowlIdx, our_team) {
  for (let i = 0; i < innings.length; i++) {
    const inn = innings[i]
    const innings_order = i + 1
    const { lastInsertRowid: result_id } = db
      .prepare('INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)')
      .run(fixture_id, innings_order)
    if (i === ourBatIdx) insertManualBatting(db, fixture_id, innings_order, inn.batting, our_team)
    if (i === ourBowlIdx) insertManualBowling(db, fixture_id, innings_order, inn.bowling, our_team)
    insertDeliveries(
      db,
      result_id,
      innings_order,
      inn,
      buildBowlerMap(db, inn.bowling, inn.bowling_team)
    )
  }
}

function commitScorecardTx(db, fixture_id, body) {
  const {
    match_date,
    match_date_iso,
    home_team,
    away_team,
    match_type,
    tags,
    competition,
    ground,
    format,
    our_team,
    innings,
    team_id,
    season_id
  } = body
  const { resolvedTags, primaryTag } = resolveFixtureTags(tags, match_type, competition)
  db.prepare(
    `INSERT INTO fixtures (fixture_id, match_date, match_date_iso, home_team, away_team,
      ground, format, starting_score, competition, match_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fixture_id,
    match_date,
    match_date_iso,
    home_team,
    away_team,
    ground || '',
    format || 'standard',
    0,
    competition || '',
    primaryTag
  )
  syncFixtureTags(db, fixture_id, resolvedTags)
  if (team_id && season_id) {
    db.prepare(
      'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
    ).run(fixture_id, Number(team_id), Number(season_id))
  }
  const [batIdx, bowlIdx] = ourInningsIndices(innings, our_team)
  insertScorecardInnings(db, fixture_id, innings, batIdx, bowlIdx, our_team)
}

// POST /api/admin/import/scorecard-commit
router.post('/import/scorecard-commit', (req, res, next) => {
  const { home_team, away_team, innings, match_date, ...rest } = req.body

  if (!home_team || !away_team || !innings?.length) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  if (!Array.isArray(innings) || innings.length > 2) {
    return res.status(400).json({ error: 'innings must be an array of at most 2 entries' })
  }

  const db = getDb()
  const fixture_id = `manual-${Date.now()}-${randomBytes(4).toString('hex')}`
  const { toIsoDate } = require('../../utils/cricket')
  const match_date_iso = toIsoDate(match_date) || null

  try {
    db.transaction(() =>
      commitScorecardTx(db, fixture_id, {
        home_team,
        away_team,
        innings,
        match_date,
        match_date_iso,
        ...rest
      })
    )()

    res.json({ fixture_id })
  } catch (err) {
    next(err)
  }
})

const MAX_GROUPS = 20

// Resolve the club name for a given team_id (super admin) or club_id (club admin).
// Returns null if the club cannot be found.
function resolveClubName(db, ctx, teamId) {
  if (ctx.isSuperAdmin) {
    const row = db
      .prepare(
        'SELECT c.name FROM watched_teams wt JOIN clubs c ON c.club_id = wt.club_id WHERE wt.team_id = ? LIMIT 1'
      )
      .get(teamId)
    return row ? row.name : null
  }
  const row = db.prepare('SELECT name FROM clubs WHERE club_id = ?').get(ctx.clubId)
  return row ? row.name : null
}

// Parse the first team_id:season_id pair from ?groups= (jersey editing is single-team).
function parseFirstGroupPair(groupsRaw) {
  const tok = groupsRaw ? groupsRaw.split(',')[0] : ''
  const [t, s] = (tok || '').split(':').map(Number)
  const teamId = Number.isFinite(t) && t > 0 ? t : 0
  const seasonId = Number.isFinite(s) && s > 0 ? s : 0
  return { teamId, seasonId }
}

// GET /api/admin/players — list club players with jersey numbers, filtered by team+season.
// Uses fixture_seasons to scope to the selected season; club-name prefix excludes opposition.
function adminGetPlayers(req, res) {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const ctx = getAuthContext(req)
  const db = getDb()
  const { teamId, seasonId } = parseFirstGroupPair(req.query.groups)
  if (!teamId || !seasonId) return res.json([])

  const clubName = resolveClubName(db, ctx, teamId)
  if (!clubName) return res.json([])

  const rows = db
    .prepare(
      `SELECT DISTINCT p.player_id AS playerId,
              COALESCE(p.display_name, p.name) AS name,
              p.jersey_number AS jerseyNumber
       FROM players p
       WHERE p.team LIKE ?
         AND p.player_id IN (
           SELECT d.batter_id FROM deliveries d
           JOIN innings i ON i.result_id = d.result_id
           JOIN fixture_seasons fs ON fs.fixture_id = i.fixture_id
           WHERE fs.team_id = ? AND fs.season_id = ?
           UNION
           SELECT d.bowler_id FROM deliveries d
           JOIN innings i ON i.result_id = d.result_id
           JOIN fixture_seasons fs ON fs.fixture_id = i.fixture_id
           WHERE fs.team_id = ? AND fs.season_id = ?
         )
       ORDER BY COALESCE(p.display_name, p.name) COLLATE NOCASE`
    )
    .all(`${clubName} - %`, teamId, seasonId, teamId, seasonId)
  res.json(rows)
}
router.get('/players', adminGetPlayers)

// PATCH /api/admin/players/jerseys — bulk-update jersey numbers [{playerId, jerseyNumber}]
router.patch('/players/jerseys', (req, res) => {
  if (!canManageUsers(req)) return res.status(403).json({ error: 'Admin access required' })
  const updates = req.body
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'Body must be an array' })

  const db = getDb()
  const stmt = db.prepare(`UPDATE players SET jersey_number = ? WHERE player_id = ?`)
  const run = db.transaction(() => {
    for (const { playerId, jerseyNumber } of updates) {
      const num = jerseyNumber === null || jerseyNumber === '' ? null : Number(jerseyNumber)
      if (num !== null && (isNaN(num) || num < 0 || num > 999)) continue
      stmt.run(num, playerId)
    }
  })
  run()
  res.json({ ok: true })
})

module.exports = router
// Exported for unit tests only
module.exports._normaliseName = normaliseName
module.exports._fuzzyNameMatch = fuzzyNameMatch
module.exports._bowlerIdFromMap = bowlerIdFromMap
module.exports._resolvePlayer = resolvePlayer
module.exports._expandFromScorecard = expandFromScorecard
module.exports._insertDeliveries = insertDeliveries
