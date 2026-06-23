'use strict'

const { getDb } = require('../db/schema')
const { sendTelegram } = require('./notify')
const { isOurTeam, getClubFilters } = require('./db')

function shortName(full) {
  if (!full) return full
  return full
    .replace(/Woking\s*(?:&|and)?\s*Horsell\s*(?:Cricket\s*Club|CC)?\s*[-–]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fmtScore(score, wickets, overs, format, startingScore) {
  if (score === null) return null
  if (format === 'pairs') {
    const net = Number(score) + (Number(startingScore) || 0) - (Number(wickets) || 0) * 5
    return `Net ${net} (${overs} ov)`
  }
  return `${score}${wickets !== null ? '/' + wickets : ''} (${overs} ov)`
}

const APP_URL = () => process.env.APP_BASE_URL || 'https://edgexi.uk'

// isOurTeam defaults to the static WHCC predicate when no per-club function is passed.
function resultEmoji(result, isOurTeamFn = isOurTeam) {
  const r = (result || '').toLowerCase()
  if (r.includes('tie') || r.includes('draw') || r.includes('no result')) return '🤝'
  if (!r.includes('won')) return '➖'
  // play-cricket result text names the winning team, e.g. "Old Woking CC - U11 - Won"
  // (a loss for us) vs "Woking & Horsell CC - U11 Whirlwinds - Won" (a win).
  return isOurTeamFn(r) ? '✅' : '❌'
}

// colWhere: a function(col) → SQL LIKE fragment scoped to the requesting club's markers.
function queryTopBat(db, fixtureId, colWhere) {
  const isOurPlayer = colWhere('p.team')
  return db
    .prepare(
      `
    SELECT p.name, SUM(d.runs_bat) AS runs, COUNT(*) AS balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players_dn p ON p.player_id = d.batter_id AND ${isOurPlayer}
    WHERE i.fixture_id = ?
    GROUP BY d.batter_id
    ORDER BY runs DESC, CAST(runs AS REAL)/COUNT(*) DESC
    LIMIT 1
  `
    )
    .get(fixtureId)
}

function queryTopBowl(db, fixtureId, colWhere) {
  const isOurPlayer = colWhere('p.team')
  return db
    .prepare(
      `
    SELECT p.name,
           SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                    AND COALESCE(dis.method,
                          CASE WHEN LOWER(COALESCE(d.l_desc,'')) LIKE '%run out%' THEN 'RunOut' ELSE '' END)
                        NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
               THEN 1 ELSE 0 END) AS wickets,
           SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players_dn p ON p.player_id = d.bowler_id AND ${isOurPlayer}
    LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                             AND dis.batter_id = d.dismissed_batter_id
                             AND dis.innings_order = i.innings_order
    WHERE i.fixture_id = ?
    GROUP BY d.bowler_id
    ORDER BY wickets DESC, CAST(runs AS REAL)/NULLIF(COUNT(*), 0) ASC
    LIMIT 1
  `
    )
    .get(fixtureId)
}

function queryMvp(db, fixtureId, colWhere) {
  const WICKET_VAL = 1.8
  const ph = '?'
  const isOurPlayer = colWhere('p.team')

  const bat = db
    .prepare(
      `
    SELECT d.batter_id AS pid, SUM(d.runs_bat) * 0.1 AS pts
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players p ON p.player_id = d.batter_id AND ${isOurPlayer}
    WHERE i.fixture_id = ${ph}
    GROUP BY d.batter_id
  `
    )
    .all(fixtureId)

  const bowl = db
    .prepare(
      `
    SELECT d.bowler_id AS pid,
           SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                    AND COALESCE(dis.method,
                          CASE WHEN LOWER(COALESCE(d.l_desc,'')) LIKE '%run out%' THEN 'RunOut' ELSE '' END)
                        NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
               THEN 1 ELSE 0 END) AS wickets
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players p ON p.player_id = d.bowler_id AND ${isOurPlayer}
    LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                             AND dis.batter_id = d.dismissed_batter_id
                             AND dis.innings_order = i.innings_order
    WHERE i.fixture_id = ${ph}
    GROUP BY d.bowler_id
  `
    )
    .all(fixtureId)

  const maidens = db
    .prepare(
      `
    SELECT ov.bowler_id AS pid, COUNT(*) AS cnt
    FROM (
      SELECT i.fixture_id, d.bowler_id, d.over_no,
             SUM(d.runs_bat + CASE WHEN d.extras_type IN (3,4) THEN 0 ELSE d.runs_extra END) AS over_runs,
             SUM(CASE WHEN d.extras_type IN (1,2) THEN 1 ELSE 0 END) AS illegal
      FROM deliveries d JOIN innings i ON i.result_id = d.result_id
      WHERE i.fixture_id = ${ph}
      GROUP BY i.fixture_id, d.result_id, d.bowler_id, d.over_no
    ) ov
    JOIN players p ON p.player_id = ov.bowler_id AND ${isOurPlayer}
    WHERE ov.over_runs = 0 AND ov.illegal = 0
    GROUP BY ov.bowler_id
  `
    )
    .all(fixtureId)

  const field = db
    .prepare(
      `
    SELECT dis.fielder_id AS pid, COUNT(*) AS catches
    FROM dismissals dis
    JOIN players p ON p.player_id = dis.fielder_id AND ${isOurPlayer}
    WHERE dis.fixture_id = ${ph}
      AND dis.method IN ('Caught', 'CaughtAndBowled', 'Stumped', 'RunOut')
    GROUP BY dis.fielder_id
  `
    )
    .all(fixtureId)

  const totals = {}
  for (const r of bat) totals[r.pid] = (totals[r.pid] || 0) + r.pts
  for (const r of bowl) {
    let pts = r.wickets * WICKET_VAL
    if (r.wickets >= 5) pts += 1.0
    else if (r.wickets >= 3) pts += 0.5
    totals[r.pid] = (totals[r.pid] || 0) + pts
  }
  for (const r of maidens) totals[r.pid] = (totals[r.pid] || 0) + r.cnt * (WICKET_VAL / 2)
  for (const r of field) totals[r.pid] = (totals[r.pid] || 0) + r.catches * (WICKET_VAL * 0.2)

  const entries = Object.entries(totals)
  if (!entries.length) return null
  const [topId, topPts] = entries.sort((a, b) => b[1] - a[1])[0]
  const row = db
    .prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE player_id = ?`)
    .get(Number(topId))
  return { name: row?.name ?? `#${topId}`, pts: +topPts.toFixed(1) }
}

function computeAndCacheStats(db, fixtureId, clubId = null) {
  const { colWhere } = getClubFilters(db, clubId)
  const topBat = queryTopBat(db, fixtureId, colWhere)
  const topBowl = queryTopBowl(db, fixtureId, colWhere)
  const mvp = queryMvp(db, fixtureId, colWhere)

  db.prepare(
    `
    INSERT OR REPLACE INTO match_stats_cache
      (fixture_id, top_bat_name, top_bat_runs, top_bat_balls,
       top_bowl_name, top_bowl_wickets, top_bowl_runs,
       mvp_name, mvp_pts, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    fixtureId,
    topBat?.name ?? null,
    topBat?.runs ?? null,
    topBat?.balls ?? null,
    topBowl?.name ?? null,
    topBowl?.wickets ?? null,
    topBowl?.runs ?? null,
    mvp?.name ?? null,
    mvp?.pts ?? null,
    Date.now()
  )

  return { topBat, topBowl, mvp }
}

function computeAndCacheManualStats(db, fixtureId) {
  const topBat = db
    .prepare(
      `
    SELECT COALESCE(p.display_name, p.name) AS name, mb.runs, mb.balls
    FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
    ORDER BY mb.runs DESC LIMIT 1
  `
    )
    .get(fixtureId)

  const topBowl = db
    .prepare(
      `
    SELECT COALESCE(p.display_name, p.name) AS name, mbw.wickets, mbw.runs
    FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ?
    ORDER BY mbw.wickets DESC, CAST(mbw.runs AS REAL)/NULLIF(mbw.balls, 0) ASC LIMIT 1
  `
    )
    .get(fixtureId)

  const batRows = db
    .prepare(
      `SELECT player_id, runs * 0.1 AS pts FROM manual_batting  WHERE fixture_id = ? AND did_not_bat = 0`
    )
    .all(fixtureId)
  const bowlRows = db
    .prepare(
      `SELECT player_id, wickets * 1.8 + CASE WHEN wickets >= 5 THEN 1.0 WHEN wickets >= 3 THEN 0.5 ELSE 0.0 END AS pts FROM manual_bowling WHERE fixture_id = ?`
    )
    .all(fixtureId)
  const totals = {}
  for (const r of [...batRows, ...bowlRows])
    totals[r.player_id] = (totals[r.player_id] || 0) + r.pts
  const entries = Object.entries(totals)
  let mvp = null
  if (entries.length) {
    const [topId, topPts] = entries.sort((a, b) => b[1] - a[1])[0]
    const row = db
      .prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE player_id = ?`)
      .get(Number(topId))
    mvp = { name: row?.name ?? `#${topId}`, pts: +topPts.toFixed(1) }
  }

  db.prepare(
    `
    INSERT OR REPLACE INTO match_stats_cache
      (fixture_id, top_bat_name, top_bat_runs, top_bat_balls,
       top_bowl_name, top_bowl_wickets, top_bowl_runs, mvp_name, mvp_pts, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    fixtureId,
    topBat?.name ?? null,
    topBat?.runs ?? null,
    topBat?.balls ?? null,
    topBowl?.name ?? null,
    topBowl?.wickets ?? null,
    topBowl?.runs ?? null,
    mvp?.name ?? null,
    mvp?.pts ?? null,
    Date.now()
  )
}

// Map the two innings to home/away. Player team strings are unreliable across
// age groups, so decide our-side-vs-opposition with isOurTeam — the same signal
// the detail page uses — never by matching the raw team string to home/away.
// Returns null when it can't be oriented (a fixture with no, or two, matching sides).
function orientInnings(db, fix, innings, isOurTeam) {
  const isOurHome = isOurTeam(fix.home_team)
  if (isOurHome === isOurTeam(fix.away_team)) return null

  const firstBatterOurs = (resultId) => {
    const row = db
      .prepare(
        `
      SELECT p.team FROM deliveries d JOIN players p ON p.player_id = d.batter_id
      WHERE d.result_id = ? AND p.team IS NOT NULL ORDER BY d.over_no, d.ball_no LIMIT 1
    `
      )
      .get(resultId)
    return isOurTeam(row?.team || '')
  }

  for (const inn of innings) inn.ourBatting = firstBatterOurs(inn.result_id)
  const homeInn = innings.find((i) => i.ourBatting === isOurHome)
  const awayInn = innings.find((i) => i !== homeInn)
  return homeInn && awayInn ? { homeInn, awayInn } : null
}

function decideResult(fix, homeInn, awayInn) {
  const ss = Number(fix.starting_score) || 0
  const net = (inn) => (fix.format === 'pairs' ? inn.runs - ss - inn.wkts * 5 : inn.runs)
  const homeNet = net(homeInn),
    awayNet = net(awayInn)
  if (homeNet === awayNet) return 'Match Tied'
  return `${homeNet > awayNet ? fix.home_team : fix.away_team} - Won`
}

function backfillFixtureSummary(db, fixtureId, clubId = null) {
  const fix = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fix || fix.home_score !== null) return false

  const innings = db
    .prepare(
      `
    SELECT i.result_id, i.innings_order,
      SUM(d.runs_bat + d.runs_extra) AS runs,
      SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END) AS wkts,
      SUM(CASE WHEN COALESCE(d.extras_type, 0) NOT IN (3, 4) THEN 1 ELSE 0 END) AS legal_balls
    FROM innings i JOIN deliveries d ON d.result_id = i.result_id
    WHERE i.fixture_id = ?
    GROUP BY i.result_id, i.innings_order
    ORDER BY i.innings_order
  `
    )
    .all(fixtureId)
  if (innings.length < 2) return false

  const effectiveClubId = clubId ?? fix.club_id ?? null
  const { isOurTeam } = getClubFilters(db, effectiveClubId)
  const oriented = orientInnings(db, fix, innings, isOurTeam)
  if (!oriented) return false
  const { homeInn, awayInn } = oriented

  const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`
  db.prepare(
    `
    UPDATE fixtures SET
      home_score = ?, away_score = ?, home_wickets = ?, away_wickets = ?,
      home_overs = ?, away_overs = ?, result = ?
    WHERE fixture_id = ?
  `
  ).run(
    String(homeInn.runs),
    String(awayInn.runs),
    String(homeInn.wkts),
    String(awayInn.wkts),
    overs(homeInn.legal_balls),
    overs(awayInn.legal_balls),
    decideResult(fix, homeInn, awayInn),
    fixtureId
  )
  return true
}

// Finalize any fixture that has full delivery data but a NULL summary. Runs at startup.
function backfillFixtureSummaries() {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT f.fixture_id, f.club_id FROM fixtures f
    WHERE f.home_score IS NULL
      AND (SELECT COUNT(DISTINCT i.result_id) FROM innings i
           JOIN deliveries d ON d.result_id = i.result_id
           WHERE i.fixture_id = f.fixture_id) >= 2
  `
    )
    .all()
  if (!rows.length) return
  let filled = 0
  for (const { fixture_id, club_id } of rows) {
    try {
      if (backfillFixtureSummary(db, fixture_id, club_id ?? null)) filled++
    } catch (e) {
      console.error('[fixture-summary] failed', fixture_id, e.message)
    }
  }
  console.log(`[fixture-summary] finalized ${filled}/${rows.length} fixture(s) from delivery data`)
}

// Populate cache for every fixture that doesn't have an entry yet.
function backfillStatsCache() {
  const db = getDb()
  db.prepare(
    `
    DELETE FROM match_stats_cache WHERE fixture_id IN (
      SELECT DISTINCT i.fixture_id FROM innings i
      JOIN deliveries d ON d.result_id = i.result_id
    )
  `
  ).run()

  const missing = db
    .prepare(
      `
    SELECT DISTINCT i.fixture_id, f.club_id FROM innings i
    JOIN fixtures f ON f.fixture_id = i.fixture_id
    LEFT JOIN match_stats_cache msc ON msc.fixture_id = i.fixture_id
    WHERE msc.fixture_id IS NULL
  `
    )
    .all()
  if (!missing.length) return
  console.log(`[stats-cache] backfilling ${missing.length} fixture(s)…`)
  const hasDeliveries = db.prepare(
    `SELECT DISTINCT i.fixture_id FROM innings i JOIN deliveries d ON d.result_id = i.result_id`
  )
  const withDeliveries = new Set(hasDeliveries.all().map((r) => r.fixture_id))
  const hasManual = db.prepare(`SELECT DISTINCT fixture_id FROM manual_batting`)
  const withManual = new Set(hasManual.all().map((r) => r.fixture_id))
  for (const { fixture_id, club_id } of missing) {
    try {
      if (withDeliveries.has(fixture_id)) computeAndCacheStats(db, fixture_id, club_id ?? null)
      else if (withManual.has(fixture_id)) computeAndCacheManualStats(db, fixture_id)
    } catch (e) {
      console.error(`[stats-cache] failed ${fixture_id}:`, e.message)
    }
  }
  console.log('[stats-cache] backfill done')
}

// Detect career and single-match milestones for our club's players in this fixture.
const RUN_THRESHOLDS = [50, 100, 250, 500, 1000, 2000]
const WKTS_THRESHOLDS = [10, 25, 50, 100]

function addMilestone(results, playerId, playerName, text) {
  if (!results[playerId]) results[playerId] = { playerId, playerName, milestones: [] }
  results[playerId].milestones.push(text)
}

function detectBatMilestones(db, fixtureId, results, colWhere) {
  const isOurPlayer = colWhere('p.team')
  const rows = db
    .prepare(
      `
    SELECT d.batter_id AS player_id,
           COALESCE(p.display_name, p.name) AS player_name,
           SUM(d.runs_bat)                                                               AS career_runs,
           SUM(CASE WHEN i.fixture_id = ? THEN d.runs_bat ELSE 0 END)                   AS match_runs
    FROM deliveries d
    JOIN innings i  ON i.result_id  = d.result_id
    JOIN players p  ON p.player_id  = d.batter_id AND ${isOurPlayer}
    WHERE d.batter_id IN (
      SELECT DISTINCT d2.batter_id FROM deliveries d2
      JOIN innings i3 ON i3.result_id = d2.result_id WHERE i3.fixture_id = ?
    )
    GROUP BY d.batter_id
  `
    )
    .all(fixtureId, fixtureId)
  for (const r of rows) {
    const pre = r.career_runs - r.match_runs
    for (const T of RUN_THRESHOLDS) {
      if (pre < T && r.career_runs >= T)
        addMilestone(results, r.player_id, r.player_name, `${T} career runs`)
    }
    if (r.match_runs >= 100)
      addMilestone(results, r.player_id, r.player_name, `${r.match_runs} runs in match`)
    else if (r.match_runs >= 50)
      addMilestone(results, r.player_id, r.player_name, `50+ runs in match (${r.match_runs})`)
  }
}

function detectBowlMilestones(db, fixtureId, results, colWhere) {
  const isOurPlayer = colWhere('p.team')
  const rows = db
    .prepare(
      `
    SELECT d.bowler_id AS player_id,
           COALESCE(p.display_name, p.name) AS player_name,
           COUNT(d.dismissed_batter_id)                                                  AS career_wkts,
           SUM(CASE WHEN i.fixture_id = ? AND d.dismissed_batter_id IS NOT NULL THEN 1 ELSE 0 END)  AS match_wkts
    FROM deliveries d
    JOIN innings i  ON i.result_id  = d.result_id
    JOIN players p  ON p.player_id  = d.bowler_id AND ${isOurPlayer}
    WHERE d.bowler_id IN (
      SELECT DISTINCT d2.bowler_id FROM deliveries d2
      JOIN innings i3 ON i3.result_id = d2.result_id WHERE i3.fixture_id = ?
    )
    GROUP BY d.bowler_id
  `
    )
    .all(fixtureId, fixtureId)
  for (const r of rows) {
    const pre = r.career_wkts - r.match_wkts
    for (const T of WKTS_THRESHOLDS) {
      if (pre < T && r.career_wkts >= T)
        addMilestone(results, r.player_id, r.player_name, `${T} career wickets`)
    }
    if (r.match_wkts >= 5)
      addMilestone(results, r.player_id, r.player_name, `${r.match_wkts} wickets in match`)
  }
}

function detectMilestones(db, fixtureId, clubId = null) {
  const { colWhere } = getClubFilters(db, clubId)
  const isOurPlayer = colWhere('p.team')
  const results = {}
  detectBatMilestones(db, fixtureId, results, colWhere)
  detectBowlMilestones(db, fixtureId, results, colWhere)

  const manualBat = db
    .prepare(
      `
    SELECT mb.player_id, COALESCE(p.display_name, p.name) AS player_name, mb.runs
    FROM manual_batting mb
    JOIN players p ON p.player_id = mb.player_id AND ${isOurPlayer}
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
  `
    )
    .all(fixtureId)
  for (const r of manualBat) {
    if (r.runs >= 100) addMilestone(results, r.player_id, r.player_name, `${r.runs} runs in match`)
    else if (r.runs >= 50)
      addMilestone(results, r.player_id, r.player_name, `50+ runs in match (${r.runs})`)
  }

  const manualBowl = db
    .prepare(
      `
    SELECT mbw.player_id, COALESCE(p.display_name, p.name) AS player_name, mbw.wickets
    FROM manual_bowling mbw
    JOIN players p ON p.player_id = mbw.player_id AND ${isOurPlayer}
    WHERE mbw.fixture_id = ? AND mbw.wickets >= 5
  `
    )
    .all(fixtureId)
  for (const r of manualBowl) {
    addMilestone(results, r.player_id, r.player_name, `${r.wickets} wickets in match`)
  }

  return Object.values(results).filter((r) => r.milestones.length > 0)
}

async function notifyMatchIngested(fixtureId) {
  const db = getDb()
  const fix = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fix) return
  if (!fix.home_team || !fix.away_team) return

  if (fix.play_cricket_id) {
    const updated = db
      .prepare(
        `UPDATE scheduled_fixtures SET notified_at = datetime('now')
       WHERE play_cricket_id = ? AND notified_at IS NULL`
      )
      .run(String(fix.play_cricket_id))
    if (updated.changes === 0) {
      console.log(`[notify] skipped duplicate notification for fixture ${fixtureId}`)
      return
    }
  }

  const clubId = fix.club_id ?? null
  const { isOurTeam } = getClubFilters(db, clubId)
  const { topBat, topBowl, mvp } = computeAndCacheStats(db, fixtureId, clubId)

  const isOurHome = isOurTeam(fix.home_team)
  const ourTeam = shortName(isOurHome ? fix.home_team : fix.away_team)
  const oppTeam = shortName(isOurHome ? fix.away_team : fix.home_team)
  const ourScore = fmtScore(
    isOurHome ? fix.home_score : fix.away_score,
    isOurHome ? fix.home_wickets : fix.away_wickets,
    isOurHome ? fix.home_overs : fix.away_overs,
    fix.format,
    fix.starting_score
  )
  const oppScore = fmtScore(
    isOurHome ? fix.away_score : fix.home_score,
    isOurHome ? fix.away_wickets : fix.home_wickets,
    isOurHome ? fix.away_overs : fix.home_overs,
    fix.format,
    fix.starting_score
  )

  const emoji = resultEmoji(fix.result, isOurTeam)
  const date = fix.match_date_iso || fix.match_date || ''
  const ground = fix.ground ? ` · ${fix.ground}` : ''
  const matchUrl = `${APP_URL()}/match/${fixtureId}`

  // nosemgrep: <b>/<a> tags are Telegram Bot API HTML formatting sent to Telegram, never to a browser
  const lines = [
    `🏏 <b>${ourTeam} v ${oppTeam}</b>`,
    `📅 ${date}${ground}`,
    '',
    `${emoji} ${ourScore ?? '—'} v ${oppScore ?? '—'}`
  ]
  if (topBat) lines.push(`\n🏏 <b>Bat:</b> ${topBat.name} ${topBat.runs} (${topBat.balls}b)`)
  if (topBowl) lines.push(`🔴 <b>Bowl:</b> ${topBowl.name} ${topBowl.wickets}/${topBowl.runs}`)
  if (mvp) lines.push(`⭐ <b>MVP:</b> ${mvp.name} (${mvp.pts} pts)`)
  lines.push(`\n<a href="${matchUrl}">View match</a>`) // nosemgrep: Telegram HTML mode — matchUrl is APP_BASE_URL+fixture_id, not user input

  await sendTelegram(lines.join('\n'))

  const { notifyNewMatch, notifyMilestones } = require('./notifications')
  const fsRow = db
    .prepare(`SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ? LIMIT 1`)
    .get(fixtureId)
  if (fsRow) {
    notifyNewMatch({
      fixtureId,
      teamId: fsRow.team_id,
      seasonId: fsRow.season_id,
      matchData: { fix, topBat, topBowl, mvp }
    }).catch((e) => console.error('[notify] new_match error:', e.message))
  }

  const milestones = detectMilestones(db, fixtureId, clubId)
  if (milestones.length) {
    notifyMilestones({ fixtureId, milestones }).catch((e) =>
      console.error('[notify] milestone error:', e.message)
    )
  }
}

module.exports = {
  notifyMatchIngested,
  computeAndCacheStats,
  computeAndCacheManualStats,
  backfillStatsCache,
  backfillFixtureSummary,
  backfillFixtureSummaries,
  detectMilestones,
  _test: { shortName, fmtScore, resultEmoji, queryMvp }
}
