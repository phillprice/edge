const express = require('express')
const router = express.Router()
const multer = require('multer')
const { clerkClient } = require('@clerk/express')
const { parseHtmlScorecard } = require('../db/htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('../db/ingest')
const { getDb } = require('../db/schema')
const { invalidateFixtureCaches } = require('../utils/cacheInvalidation')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

function parseMsDate(raw) {
  if (!raw) return null
  const m = raw.match(/\/Date\((\d+)/)
  return m ? Number(m[1]) : null
}

function minTimestamp(data) {
  let min = Infinity
  for (const d of data) {
    const t = parseMsDate(d.last_update_time)
    if (t !== null && t < min) min = t
  }
  return min === Infinity ? 0 : min
}

// POST /api/ingest
// Accepts: optional print.html scorecard + one or more innings JSON files.
// Innings order: determined by minimum last_update_time in each JSON (earliest = innings 1).
// Fixture ID = minimum result_id across all JSON files (stable internal ID, filename-independent).
// Duplicate uploads are safe: all SQL ops use ON CONFLICT upserts.
router.post('/', upload.array('files', 10), async (req, res, next) => {
  try {
    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' })

    const htmlFile = files.find((f) => f.originalname.toLowerCase().endsWith('.html'))
    const jsonFiles = files.filter((f) => f.originalname.toLowerCase().endsWith('.json'))

    if (!jsonFiles.length)
      return res.status(400).json({ error: 'At least one innings JSON file is required' })

    let matchMeta = null
    if (htmlFile) {
      matchMeta = parseHtmlScorecard(htmlFile.buffer.toString('utf-8'))
    }

    // Duplicate detection — skip if overwrite=true
    if (matchMeta && req.query.overwrite !== 'true') {
      const db = getDb()
      const existing = db
        .prepare(
          'SELECT fixture_id FROM fixtures WHERE home_team = ? AND away_team = ? AND match_date = ?'
        )
        .get(matchMeta.homeTeam, matchMeta.awayTeam, matchMeta.matchDate)
      if (existing) {
        return res.json({
          alreadyExists: true,
          fixtureId: existing.fixture_id,
          message: `Match already ingested (fixture #${existing.fixture_id})`
        })
      }
    }

    // Parse all JSON files
    const parsed = jsonFiles.map((f) => {
      let data
      try {
        data = JSON.parse(f.buffer.toString('utf-8'))
      } catch {
        throw Object.assign(new Error(`${f.originalname} is not valid JSON`), { status: 400 })
      }
      if (!Array.isArray(data) || !data.length)
        throw Object.assign(new Error(`${f.originalname} is not a valid array`), { status: 400 })
      const resultId = data[0]?.result_id
      if (!resultId)
        throw Object.assign(new Error(`No result_id in ${f.originalname}`), { status: 400 })
      return { file: f, data, resultId, minTime: minTimestamp(data) }
    })

    // Sort by earliest timestamp so innings 1 (batted first) comes first
    parsed.sort((a, b) => a.minTime - b.minTime)

    // Fixture ID = minimum result_id (stable, internal, independent of filename)
    const fixtureId = String(Math.min(...parsed.map((p) => p.resultId)))

    const results = []
    for (let i = 0; i < parsed.length; i++) {
      const { file, data, resultId } = parsed[i]
      const inningsOrder = i + 1
      const stats = ingestDeliveries(fixtureId, inningsOrder, resultId, data, matchMeta)
      results.push({ file: file.originalname, fixtureId, resultId, inningsOrder, ...stats })
    }

    // Auto-populate captain and WK assignments from HTML flags
    if (matchMeta) autoPopulateRoles(fixtureId)

    // Invalidate fixture-scoped caches so next load recomputes from fresh data
    invalidateFixtureCaches(getDb(), fixtureId)

    // Audit log
    const uploadedFileNames = files.map((f) => f.originalname)
    const rowCounts = results.reduce((acc, r) => {
      acc.deliveries = (acc.deliveries || 0) + (r.deliveries || 0)
      acc.players = (acc.players || 0) + (r.players || 0)
      return acc
    }, {})
    let userName = null
    if (req.auth?.userId && process.env.CLERK_SECRET_KEY) {
      try {
        const user = await clerkClient.users.getUser(req.auth.userId)
        userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      } catch (_) {}
    }
    getDb()
      .prepare(
        `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        fixtureId ?? null,
        req.auth?.userId ?? null,
        userName,
        Date.now(),
        JSON.stringify(uploadedFileNames),
        JSON.stringify(rowCounts)
      )

    res.json({
      ok: true,
      results,
      matchMeta: matchMeta ? { ...matchMeta, players: undefined } : null
    })
  } catch (err) {
    console.error('Ingest error:', err)
    next(err)
  }
})

module.exports = router
