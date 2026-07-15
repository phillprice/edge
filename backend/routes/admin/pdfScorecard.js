'use strict'

const express = require('express')
const router = express.Router()
const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomBytes } = require('crypto')
const { getDb } = require('../../db/schema')
const { isOurTeam } = require('../../utils/db')
const { parseScorecard } = require('../../utils/pdfScorecard')
const { upload, VALID_TAGS, syncFixtureTags, tagsFromCompetition } = require('./shared')
const { validateBody, z } = require('../../utils/validate')

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

// An existing candidate is only a safe reuse if we're not confident they're on the opposite
// side — i.e. their stored team is blank (legacy/manual rows with no team recorded, where we
// can't tell either way — preserve the old permissive behaviour) or both names classify the
// same way under isOurTeam. Without this, a name that happens to match an unrelated existing
// player on the other side (e.g. a real WHCC player who shares a name with an opposition
// player in an imported friendly) silently merges two different people's stats together.
function sameSide(existingTeam, incomingTeam) {
  if (!existingTeam) return true
  return isOurTeam(existingTeam) === isOurTeam(incomingTeam)
}

function findOrCreate(db, name, team) {
  const t = (name || '').trim()
  if (!t) return null
  const exact = db
    .prepare(`SELECT player_id, team FROM players WHERE name = ? COLLATE NOCASE`)
    .all(t)
  const exactMatch = exact.find((c) => sameSide(c.team, team))
  if (exactMatch) return exactMatch.player_id

  const resolved = resolvePlayer(db, t)
  if (resolved?.player_id) {
    const candidate = db
      .prepare(`SELECT team FROM players WHERE player_id = ?`)
      .get(resolved.player_id)
    if (sameSide(candidate?.team, team)) return resolved.player_id
  }

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
    insertManualBatting(db, fixture_id, innings_order, inn.batting, inn.batting_team || our_team)
    insertManualBowling(db, fixture_id, innings_order, inn.bowling, inn.bowling_team || our_team)
    insertDeliveries(
      db,
      result_id,
      innings_order,
      inn,
      buildBowlerMap(db, inn.bowling, inn.bowling_team)
    )
  }
}

// Optional bonus data from non-PDF import sources (currently only the CricHeroes/twenty20
// importer sends these) — absent for the existing PDF flow, so this is purely additive.
function insertExtras(db, fixture_id, extras) {
  if (!extras) return
  db.prepare(
    `INSERT OR REPLACE INTO manual_extras
     (fixture_id, batting_extras, bowling_byes, bowling_leg_byes, our_overs, opp_overs)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    fixture_id,
    extras.batting_extras || 0,
    extras.bowling_byes || 0,
    extras.bowling_leg_byes || 0,
    extras.our_overs || null,
    extras.opp_overs || null
  )
}

function insertCaptains(db, fixture_id, captains = []) {
  for (const c of captains || []) {
    const pid = c.player_id ? Number(c.player_id) : findOrCreate(db, c.name)
    if (!pid) continue
    db.prepare(
      'INSERT OR IGNORE INTO match_captains (fixture_id, innings_order, player_id) VALUES (?, ?, ?)'
    ).run(fixture_id, c.innings_order, pid)
  }
}

function insertKeepers(db, fixture_id, keepers = []) {
  for (const k of keepers || []) {
    const pid = k.player_id ? Number(k.player_id) : findOrCreate(db, k.name)
    if (!pid) continue
    db.prepare(
      `INSERT OR IGNORE INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over)
       VALUES (?, ?, ?, ?, ?)`
    ).run(fixture_id, k.innings_order, pid, k.from_over || 1, k.to_over ?? null)
  }
}

function insertCaptainsAndKeepers(db, fixture_id, captains = [], keepers = []) {
  insertCaptains(db, fixture_id, captains)
  insertKeepers(db, fixture_id, keepers)
}

const EMPTY_FINAL_SCORE = {
  home_score: null,
  away_score: null,
  home_wickets: null,
  away_wickets: null,
  home_overs: null,
  away_overs: null,
  result: null
}

function insertFixtureRow(db, fixture_id, body, primaryTag) {
  const { match_date, match_date_iso, home_team, away_team, ground, format, competition } = body
  const score = { ...EMPTY_FINAL_SCORE, ...body.finalScore }
  db.prepare(
    `INSERT INTO fixtures (fixture_id, match_date, match_date_iso, home_team, away_team,
      ground, format, starting_score, competition, match_type,
      home_score, away_score, home_wickets, away_wickets, home_overs, away_overs, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    primaryTag,
    score.home_score,
    score.away_score,
    score.home_wickets,
    score.away_wickets,
    score.home_overs,
    score.away_overs,
    score.result
  )
}

function commitScorecardTx(db, fixture_id, body) {
  const {
    match_type,
    tags,
    competition,
    our_team,
    innings,
    team_id,
    season_id,
    extras,
    captains,
    keepers
  } = body
  const { resolvedTags, primaryTag } = resolveFixtureTags(tags, match_type, competition)
  insertFixtureRow(db, fixture_id, body, primaryTag)
  syncFixtureTags(db, fixture_id, resolvedTags)
  if (team_id && season_id) {
    db.prepare(
      'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
    ).run(fixture_id, Number(team_id), Number(season_id))
  }
  const [batIdx, bowlIdx] = ourInningsIndices(innings, our_team)
  insertScorecardInnings(db, fixture_id, innings, batIdx, bowlIdx, our_team)
  insertExtras(db, fixture_id, extras)
  insertCaptainsAndKeepers(db, fixture_id, captains, keepers)
}

// Each innings carries PDF-derived batting/bowling rows plus ball-reconstruction fields
// consumed deep inside insertDeliveries/insertManualBatting/insertManualBowling — validate
// the shape (arrays where arrays are expected) without modelling every field, since those
// helpers already tolerate missing optional fields.
const scorecardInningsSchema = z
  .object({
    batting: z.array(z.record(z.string(), z.unknown())).optional(),
    bowling: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .passthrough()

const scorecardCommitSchema = z
  .object({
    home_team: z.string().min(1, 'home_team is required'),
    away_team: z.string().min(1, 'away_team is required'),
    innings: z.array(scorecardInningsSchema).min(1).max(2)
  })
  .passthrough()

// POST /api/admin/import/scorecard-commit
router.post('/import/scorecard-commit', validateBody(scorecardCommitSchema), (req, res, next) => {
  const { home_team, away_team, innings, match_date, ...rest } = req.body

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

module.exports = router
module.exports._normaliseName = normaliseName
module.exports._fuzzyNameMatch = fuzzyNameMatch
module.exports._bowlerIdFromMap = bowlerIdFromMap
module.exports._resolvePlayer = resolvePlayer
module.exports._expandFromScorecard = expandFromScorecard
module.exports._insertDeliveries = insertDeliveries
// Real (non-test-only) exports reused by ./twenty20Import.js's parse route, which shares
// this module's player-resolution and side-matching logic rather than duplicating it.
module.exports.resolvePlayer = resolvePlayer
module.exports.sameSide = sameSide
