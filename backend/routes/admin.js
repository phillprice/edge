const express = require('express')
const router  = express.Router()
const multer  = require('multer')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { clerkClient } = require('@clerk/express')
const { getDb, closeDb, DB_PATH } = require('../db/schema')
const { fetchMatchData }    = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('../db/htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('../db/ingest')

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

// GET /api/admin/export — hot backup of the SQLite database
router.get('/export', async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {}))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/import — replace the database with an uploaded .db file
router.post('/import', upload.single('db'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate SQLite magic bytes
  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer)
    closeDb()
    // Remove WAL and shared-memory files so the new DB starts clean
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix) } catch (_) {}
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath)
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
    const isWhcc = t => /woking|horsell|whirlwind|whcc|hurricane/i.test(t || '')
    const team = fixture
      ? (isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
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

// GET /api/admin/duplicate-players — groups of players sharing the same effective name
router.get('/duplicate-players', (req, res) => {
  const db = getDb()
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
      GROUP BY lower(COALESCE(display_name, name))
      HAVING COUNT(*) > 1
    )
    AND COALESCE(p.ignore_flag, 0) = 0
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
      AND (lower(f.home_team) LIKE '%woking%' OR lower(f.home_team) LIKE '%horsell%'
        OR lower(f.away_team) LIKE '%woking%' OR lower(f.away_team) LIKE '%horsell%'
        OR lower(f.home_team) LIKE '%whirlwind%' OR lower(f.home_team) LIKE '%hurricane%'
        OR lower(f.away_team) LIKE '%whirlwind%' OR lower(f.away_team) LIKE '%hurricane%')
    GROUP BY f.fixture_id
    HAVING has_captain = 0 OR has_wk = 0
    ORDER BY f.match_date DESC
  `).all()
  res.json(rows)
})

// POST /api/admin/merge-players — reassign all data from dropId to keepId, then delete dropId
router.post('/merge-players', (req, res) => {
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
    const data = await fetchMatchData(playCricketId)
    const matchMeta = parseHtmlScorecard(data.printHtml)

    const results = []
    for (const inn of data.innings) {
      if (!Array.isArray(inn.json) || !inn.json.length) continue
      const stats = ingestDeliveries(data.dbFixtureId, inn.inningsOrder, inn.resultId, inn.json, matchMeta)
      results.push({ resultId: inn.resultId, inningsOrder: inn.inningsOrder, ...stats })
    }

    if (matchMeta && results.length) autoPopulateRoles(data.dbFixtureId)

    // Persist the play-cricket ID so the match detail page can offer a re-ingest button
    const db = getDb()
    db.prepare(`UPDATE fixtures SET play_cricket_id = ? WHERE fixture_id = ?`).run(playCricketId, data.dbFixtureId)
    db.prepare(`DELETE FROM mvp_cache WHERE fixture_id = ?`).run(data.dbFixtureId)

    let userName = null
    if (req.auth?.userId && process.env.CLERK_SECRET_KEY) {
      try {
        const user = await clerkClient.users.getUser(req.auth.userId)
        userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      } catch (_) {}
    }
    db.prepare(
      `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(data.dbFixtureId, req.auth?.userId ?? null, userName, Date.now(), JSON.stringify(['play-cricket']), JSON.stringify({ innings: results.length }))

    res.json({
      ok: true,
      playCricketId,
      fixtureId: data.dbFixtureId,
      rvMatchId: data.rvMatchId,
      results,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined, innings: undefined } : null,
    })
  } catch (err) {
    console.error('fetch-match error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
