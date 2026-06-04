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
  if (score == null) return null
  return `${score}${wickets != null ? '/' + wickets : ''} (${overs} ov)`
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
}

module.exports = { notifyMatchIngested, computeAndCacheStats, computeAndCacheManualStats, backfillStatsCache, _test: { shortName, fmtScore, resultEmoji } }
