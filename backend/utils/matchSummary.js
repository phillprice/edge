const { getDb } = require('../db/schema')
const { sendTelegram } = require('./notify')
const { isWhccTeam, whccCol } = require('./db')

const IS_WHCC = whccCol('p.team')

function shortName(full) {
  if (!full) return full
  return full
    .replace(/Woking\s*(?:&|and)?\s*Horsell\s*(?:Cricket\s*Club|CC)?\s*[-–]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fmtScore(score, wickets, overs) {
  if (score === null) return null
  return `${score}${wickets !== null ? '/' + wickets : ''} (${overs} ov)`
}

function resultEmoji(result) {
  const r = (result || '').toLowerCase()
  if (r.includes('tie') || r.includes('draw') || r.includes('no result')) return '🤝'
  if (!r.includes('won')) return '➖'
  // play-cricket result text names the winning team, e.g. "Old Woking CC - U11 - Won"
  // (a loss for us) vs "Woking & Horsell CC - U11 Whirlwinds - Won" (a win).
  return isWhccTeam(r) ? '✅' : '❌'
}

function queryTopBat(db, fixtureId) {
  return db.prepare(`
    SELECT p.name, SUM(d.runs_bat) AS runs, COUNT(*) AS balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players_dn p ON p.player_id = d.batter_id AND ${IS_WHCC}
    WHERE i.fixture_id = ?
    GROUP BY d.batter_id
    ORDER BY runs DESC, CAST(runs AS REAL)/COUNT(*) DESC
    LIMIT 1
  `).get(fixtureId)
}

function queryTopBowl(db, fixtureId) {
  return db.prepare(`
    SELECT p.name,
           COUNT(d.dismissed_batter_id) AS wickets,
           SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players_dn p ON p.player_id = d.bowler_id AND ${IS_WHCC}
    WHERE i.fixture_id = ?
    GROUP BY d.bowler_id
    ORDER BY wickets DESC, CAST(runs AS REAL)/NULLIF(COUNT(*), 0) ASC
    LIMIT 1
  `).get(fixtureId)
}

function queryMvp(db, fixtureId) {
  const WICKET_VAL = 1.8
  const ph = '?'

  const bat = db.prepare(`
    SELECT d.batter_id AS pid, SUM(d.runs_bat) * 0.1 AS pts
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players p ON p.player_id = d.batter_id AND ${IS_WHCC}
    WHERE i.fixture_id = ${ph}
    GROUP BY d.batter_id
  `).all(fixtureId)

  const bowl = db.prepare(`
    SELECT d.bowler_id AS pid, COUNT(d.dismissed_batter_id) AS wickets
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players p ON p.player_id = d.bowler_id AND ${IS_WHCC}
    WHERE i.fixture_id = ${ph}
    GROUP BY d.bowler_id
  `).all(fixtureId)

  const maidens = db.prepare(`
    SELECT ov.bowler_id AS pid, COUNT(*) AS cnt
    FROM (
      SELECT i.fixture_id, d.bowler_id, d.over_no,
             SUM(d.runs_bat + d.runs_extra) AS over_runs,
             SUM(CASE WHEN d.extras_type IN (1,2) THEN 1 ELSE 0 END) AS illegal
      FROM deliveries d JOIN innings i ON i.result_id = d.result_id
      WHERE i.fixture_id = ${ph}
      GROUP BY i.fixture_id, d.result_id, d.bowler_id, d.over_no
    ) ov
    JOIN players p ON p.player_id = ov.bowler_id AND ${IS_WHCC}
    WHERE ov.over_runs = 0 AND ov.illegal = 0
    GROUP BY ov.bowler_id
  `).all(fixtureId)

  const totals = {}
  for (const r of bat)     totals[r.pid] = (totals[r.pid] || 0) + r.pts
  for (const r of bowl) {
    let pts = r.wickets * WICKET_VAL
    if (r.wickets >= 5) pts += 1.0
    else if (r.wickets >= 3) pts += 0.5
    totals[r.pid] = (totals[r.pid] || 0) + pts
  }
  for (const r of maidens) totals[r.pid] = (totals[r.pid] || 0) + r.cnt * (WICKET_VAL / 2)

  const entries = Object.entries(totals)
  if (!entries.length) return null
  const [topId, topPts] = entries.sort((a, b) => b[1] - a[1])[0]
  const row = db.prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE player_id = ?`).get(Number(topId))
  return { name: row?.name ?? `#${topId}`, pts: +topPts.toFixed(1) }
}

function computeAndCacheStats(db, fixtureId) {
  const topBat  = queryTopBat(db, fixtureId)
  const topBowl = queryTopBowl(db, fixtureId)
  const mvp     = queryMvp(db, fixtureId)

  db.prepare(`
    INSERT OR REPLACE INTO match_stats_cache
      (fixture_id, top_bat_name, top_bat_runs, top_bat_balls,
       top_bowl_name, top_bowl_wickets, top_bowl_runs,
       mvp_name, mvp_pts, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixtureId,
    topBat?.name  ?? null, topBat?.runs  ?? null, topBat?.balls ?? null,
    topBowl?.name ?? null, topBowl?.wickets ?? null, topBowl?.runs ?? null,
    mvp?.name ?? null, mvp?.pts ?? null,
    Date.now(),
  )

  return { topBat, topBowl, mvp }
}

function computeAndCacheManualStats(db, fixtureId) {
  const topBat = db.prepare(`
    SELECT COALESCE(p.display_name, p.name) AS name, mb.runs, mb.balls
    FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
    ORDER BY mb.runs DESC LIMIT 1
  `).get(fixtureId)

  const topBowl = db.prepare(`
    SELECT COALESCE(p.display_name, p.name) AS name, mbw.wickets, mbw.runs
    FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ?
    ORDER BY mbw.wickets DESC, CAST(mbw.runs AS REAL)/NULLIF(mbw.balls, 0) ASC LIMIT 1
  `).get(fixtureId)

  const batRows  = db.prepare(`SELECT player_id, runs * 0.1 AS pts FROM manual_batting  WHERE fixture_id = ? AND did_not_bat = 0`).all(fixtureId)
  const bowlRows = db.prepare(`SELECT player_id, wickets * 1.8 + CASE WHEN wickets >= 5 THEN 1.0 WHEN wickets >= 3 THEN 0.5 ELSE 0.0 END AS pts FROM manual_bowling WHERE fixture_id = ?`).all(fixtureId)
  const totals = {}
  for (const r of [...batRows, ...bowlRows]) totals[r.player_id] = (totals[r.player_id] || 0) + r.pts
  const entries = Object.entries(totals)
  let mvp = null
  if (entries.length) {
    const [topId, topPts] = entries.sort((a, b) => b[1] - a[1])[0]
    const row = db.prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE player_id = ?`).get(Number(topId))
    mvp = { name: row?.name ?? `#${topId}`, pts: +topPts.toFixed(1) }
  }

  db.prepare(`
    INSERT OR REPLACE INTO match_stats_cache
      (fixture_id, top_bat_name, top_bat_runs, top_bat_balls,
       top_bowl_name, top_bowl_wickets, top_bowl_runs, mvp_name, mvp_pts, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixtureId,
    topBat?.name ?? null, topBat?.runs ?? null, topBat?.balls ?? null,
    topBowl?.name ?? null, topBowl?.wickets ?? null, topBowl?.runs ?? null,
    mvp?.name ?? null, mvp?.pts ?? null,
    Date.now(),
  )
}

// When ball-by-ball deliveries are ingested without scraped match metadata
// (result not yet published on the source), the fixture summary columns
// (home_score, away_score, wickets, overs, result) stay NULL. The match-detail
// page computes a result live from the scorecards, but the match list and
// season views read these columns and so show no result — the two views
// disagree. Derive the summary from the delivery data so every view agrees.
//
// Only runs when home_score IS NULL, so a genuine scraped result is never
// overwritten. Returns true if it finalized the fixture.
// Map the two innings to home/away. Player team strings are unreliable across
// age groups (a "Whirlwinds" fixture can carry "Hurricanes"-tagged players), so
// decide WHCC-vs-opposition with isWhccTeam — the same signal the detail page
// uses — never by matching the raw team string to home/away. Returns null when
// it can't be oriented (a fixture with no, or two, WHCC sides).
function orientInnings(db, fix, innings) {
  const isWhccHome = isWhccTeam(fix.home_team)
  if (isWhccHome === isWhccTeam(fix.away_team)) return null

  const firstBatterWhcc = (resultId) => {
    const row = db.prepare(`
      SELECT p.team FROM deliveries d JOIN players p ON p.player_id = d.batter_id
      WHERE d.result_id = ? AND p.team IS NOT NULL ORDER BY d.over_no, d.ball_no LIMIT 1
    `).get(resultId)
    return isWhccTeam(row?.team || '')
  }

  for (const inn of innings) inn.whccBatting = firstBatterWhcc(inn.result_id)
  const homeInn = innings.find(i => i.whccBatting === isWhccHome)
  const awayInn = innings.find(i => i !== homeInn)
  return homeInn && awayInn ? { homeInn, awayInn } : null
}

// Result text in the scraped "<winning team> - Won" / "Match Tied" format that
// isWhcc(result) keys off. Net scoring for pairs, raw runs otherwise.
function decideResult(fix, homeInn, awayInn) {
  const ss = Number(fix.starting_score) || 0
  const net = (inn) => fix.format === 'pairs' ? inn.runs - ss - inn.wkts * 5 : inn.runs
  const homeNet = net(homeInn), awayNet = net(awayInn)
  if (homeNet === awayNet) return 'Match Tied'
  return `${homeNet > awayNet ? fix.home_team : fix.away_team} - Won`
}

function backfillFixtureSummary(db, fixtureId) {
  const fix = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fix || fix.home_score !== null) return false

  // Team total = runs_bat + all runs_extra; legal balls exclude wides(3)/no-balls(4).
  const innings = db.prepare(`
    SELECT i.result_id, i.innings_order,
      SUM(d.runs_bat + d.runs_extra) AS runs,
      SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) AS wkts,
      SUM(CASE WHEN COALESCE(d.extras_type, 0) NOT IN (3, 4) THEN 1 ELSE 0 END) AS legal_balls
    FROM innings i JOIN deliveries d ON d.result_id = i.result_id
    WHERE i.fixture_id = ?
    GROUP BY i.result_id, i.innings_order
    ORDER BY i.innings_order
  `).all(fixtureId)
  if (innings.length < 2) return false   // single innings — match in progress, leave to live fallback

  const oriented = orientInnings(db, fix, innings)
  if (!oriented) return false
  const { homeInn, awayInn } = oriented

  const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`
  db.prepare(`
    UPDATE fixtures SET
      home_score = ?, away_score = ?, home_wickets = ?, away_wickets = ?,
      home_overs = ?, away_overs = ?, result = ?
    WHERE fixture_id = ?
  `).run(
    String(homeInn.runs), String(awayInn.runs),
    String(homeInn.wkts), String(awayInn.wkts),
    overs(homeInn.legal_balls), overs(awayInn.legal_balls),
    decideResult(fix, homeInn, awayInn), fixtureId,
  )
  return true
}

// Finalize any fixture that has full delivery data but a NULL summary (i.e. was
// ingested ball-by-ball before its result was published). Runs at startup.
function backfillFixtureSummaries() {
  const db = getDb()
  const rows = db.prepare(`
    SELECT f.fixture_id FROM fixtures f
    WHERE f.home_score IS NULL
      AND (SELECT COUNT(DISTINCT i.result_id) FROM innings i
           JOIN deliveries d ON d.result_id = i.result_id
           WHERE i.fixture_id = f.fixture_id) >= 2
  `).all()
  if (!rows.length) return
  let filled = 0
  for (const { fixture_id } of rows) {
    try { if (backfillFixtureSummary(db, fixture_id)) filled++ }
    catch (e) { console.error('[fixture-summary] failed', fixture_id, e.message) }
  }
  console.log(`[fixture-summary] finalized ${filled}/${rows.length} fixture(s) from delivery data`)
}

// Populate cache for every fixture that doesn't have an entry yet.
function backfillStatsCache() {
  const db = getDb()
  const missing = db.prepare(`
    SELECT DISTINCT i.fixture_id FROM innings i
    LEFT JOIN match_stats_cache msc ON msc.fixture_id = i.fixture_id
    WHERE msc.fixture_id IS NULL
  `).all()
  if (!missing.length) return
  console.log(`[stats-cache] backfilling ${missing.length} fixture(s)…`)
  const hasDeliveries = db.prepare(`SELECT DISTINCT i.fixture_id FROM innings i JOIN deliveries d ON d.result_id = i.result_id`)
  const withDeliveries = new Set(hasDeliveries.all().map(r => r.fixture_id))
  const hasManual = db.prepare(`SELECT DISTINCT fixture_id FROM manual_batting`)
  const withManual = new Set(hasManual.all().map(r => r.fixture_id))
  for (const { fixture_id } of missing) {
    try {
      if (withDeliveries.has(fixture_id)) computeAndCacheStats(db, fixture_id)
      else if (withManual.has(fixture_id)) computeAndCacheManualStats(db, fixture_id)
    } catch (e) { console.error(`[stats-cache] failed ${fixture_id}:`, e.message) }
  }
  console.log('[stats-cache] backfill done')
}

// Detect career and single-match milestones for WHCC players in this fixture.
// Returns [{ playerId, playerName, milestones: string[] }]
const RUN_THRESHOLDS  = [50, 100, 250, 500, 1000, 2000]
const WKTS_THRESHOLDS = [10, 25, 50, 100]

function addMilestone(results, playerId, playerName, text) {
  if (!results[playerId]) results[playerId] = { playerId, playerName, milestones: [] }
  results[playerId].milestones.push(text)
}

function detectBatMilestones(db, fixtureId, results) {
  const rows = db.prepare(`
    SELECT d.batter_id AS player_id,
           COALESCE(p.display_name, p.name) AS player_name,
           SUM(d.runs_bat)                                                               AS career_runs,
           SUM(CASE WHEN i2.fixture_id = ? THEN d.runs_bat ELSE 0 END)                  AS match_runs
    FROM deliveries d
    JOIN innings i  ON i.result_id  = d.result_id
    JOIN players p  ON p.player_id  = d.batter_id AND ${IS_WHCC}
    WHERE d.batter_id IN (
      SELECT DISTINCT d2.batter_id FROM deliveries d2
      JOIN innings i3 ON i3.result_id = d2.result_id WHERE i3.fixture_id = ?
    )
    GROUP BY d.batter_id
  `).all(fixtureId, fixtureId)
  for (const r of rows) {
    const pre = r.career_runs - r.match_runs
    for (const T of RUN_THRESHOLDS) {
      if (pre < T && r.career_runs >= T) addMilestone(results, r.player_id, r.player_name, `${T} career runs`)
    }
    if (r.match_runs >= 100) addMilestone(results, r.player_id, r.player_name, `${r.match_runs} runs in match`)
    else if (r.match_runs >= 50) addMilestone(results, r.player_id, r.player_name, `50+ runs in match (${r.match_runs})`)
  }
}

function detectBowlMilestones(db, fixtureId, results) {
  const rows = db.prepare(`
    SELECT d.bowler_id AS player_id,
           COALESCE(p.display_name, p.name) AS player_name,
           COUNT(d.dismissed_batter_id)                                                  AS career_wkts,
           SUM(CASE WHEN i2.fixture_id = ? AND d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) AS match_wkts
    FROM deliveries d
    JOIN innings i  ON i.result_id  = d.result_id
    JOIN players p  ON p.player_id  = d.bowler_id AND ${IS_WHCC}
    WHERE d.bowler_id IN (
      SELECT DISTINCT d2.bowler_id FROM deliveries d2
      JOIN innings i3 ON i3.result_id = d2.result_id WHERE i3.fixture_id = ?
    )
    GROUP BY d.bowler_id
  `).all(fixtureId, fixtureId)
  for (const r of rows) {
    const pre = r.career_wkts - r.match_wkts
    for (const T of WKTS_THRESHOLDS) {
      if (pre < T && r.career_wkts >= T) addMilestone(results, r.player_id, r.player_name, `${T} career wickets`)
    }
    if (r.match_wkts >= 5) addMilestone(results, r.player_id, r.player_name, `${r.match_wkts} wickets in match`)
  }
}

function detectMilestones(db, fixtureId) {
  const results = {}
  detectBatMilestones(db, fixtureId, results)
  detectBowlMilestones(db, fixtureId, results)

  const manualBat = db.prepare(`
    SELECT mb.player_id, COALESCE(p.display_name, p.name) AS player_name, mb.runs
    FROM manual_batting mb
    JOIN players p ON p.player_id = mb.player_id AND ${IS_WHCC}
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
  `).all(fixtureId)
  for (const r of manualBat) {
    if (r.runs >= 100) addMilestone(results, r.player_id, r.player_name, `${r.runs} runs in match`)
    else if (r.runs >= 50) addMilestone(results, r.player_id, r.player_name, `50+ runs in match (${r.runs})`)
  }

  const manualBowl = db.prepare(`
    SELECT mbw.player_id, COALESCE(p.display_name, p.name) AS player_name, mbw.wickets
    FROM manual_bowling mbw
    JOIN players p ON p.player_id = mbw.player_id AND ${IS_WHCC}
    WHERE mbw.fixture_id = ? AND mbw.wickets >= 5
  `).all(fixtureId)
  for (const r of manualBowl) {
    addMilestone(results, r.player_id, r.player_name, `${r.wickets} wickets in match`)
  }

  return Object.values(results).filter(r => r.milestones.length > 0)
}

async function notifyMatchIngested(fixtureId) {
  const db  = getDb()
  const fix = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fix) return

  const { topBat, topBowl, mvp } = computeAndCacheStats(db, fixtureId)

  const isWhccHome = isWhccTeam(fix.home_team)
  const whccTeam  = shortName(isWhccHome ? fix.home_team : fix.away_team)
  const oppTeam   = shortName(isWhccHome ? fix.away_team : fix.home_team)
  const whccScore = fmtScore(
    isWhccHome ? fix.home_score   : fix.away_score,
    isWhccHome ? fix.home_wickets : fix.away_wickets,
    isWhccHome ? fix.home_overs   : fix.away_overs,
  )
  const oppScore = fmtScore(
    isWhccHome ? fix.away_score   : fix.home_score,
    isWhccHome ? fix.away_wickets : fix.home_wickets,
    isWhccHome ? fix.away_overs   : fix.home_overs,
  )

  const emoji  = resultEmoji(fix.result)
  const date   = fix.match_date_iso || fix.match_date || ''
  const ground = fix.ground ? ` · ${fix.ground}` : ''

  // nosemgrep: <b> tags are Telegram Bot API HTML formatting sent to Telegram, never to a browser
  const lines = [
    `🏏 <b>${whccTeam} v ${oppTeam}</b>`,
    `📅 ${date}${ground}`,
    '',
    `${emoji} ${whccScore ?? '—'} v ${oppScore ?? '—'}`,
  ]
  if (topBat)  lines.push(`\n🦇 <b>Bat:</b> ${topBat.name} ${topBat.runs} (${topBat.balls}b)`)
  if (topBowl) lines.push(`🎳 <b>Bowl:</b> ${topBowl.name} ${topBowl.wickets}/${topBowl.runs}`)
  if (mvp)     lines.push(`⭐ <b>MVP:</b> ${mvp.name} (${mvp.pts} pts)`)

  await sendTelegram(lines.join('\n'))

  // Fire-and-forget email/per-user Telegram notifications
  const { notifyNewMatch, notifyMilestones } = require('./notifications')
  const fsRow = db.prepare(`SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ? LIMIT 1`).get(fixtureId)
  if (fsRow) {
    notifyNewMatch({
      fixtureId,
      teamId:    fsRow.team_id,
      seasonId:  fsRow.season_id,
      matchData: { fix, topBat, topBowl, mvp },
    }).catch(e => console.error('[notify] new_match error:', e.message))
  }

  const milestones = detectMilestones(db, fixtureId)
  if (milestones.length) {
    notifyMilestones({ fixtureId, milestones }).catch(e => console.error('[notify] milestone error:', e.message))
  }
}

module.exports = { notifyMatchIngested, computeAndCacheStats, computeAndCacheManualStats, backfillStatsCache, backfillFixtureSummary, backfillFixtureSummaries, detectMilestones, _test: { shortName, fmtScore, resultEmoji } }
