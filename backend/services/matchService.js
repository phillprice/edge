'use strict'

const { tagsSubquery } = require('../utils/tags')

const { isOurTeam: _isOurTeamDefault, yearExpr: _yearExpr, getClubFilters } = require('../utils/db')
const { getAuthContext } = require('../middleware/auth')
const { buildAccessFilter, buildGroupFilter } = require('../utils/access')
const {
  getPartnerships,
  getPhaseStats,
  getSpells,
  buildManualScorecard,
  buildScorecard
} = require('../utils/scorecard')
const { computeManualMvpForFixtures, bowlerMvpPoints } = require('../utils/mvp')
const { parseTypes, typesClause } = require('../utils/competitionFilter')
const { getClubShowMvp } = require('../utils/db')
const { buildMvpForFixture } = require('./mvpCaching')

const DEFAULT_OVERS = 20

function groupFilterClause(req) {
  const f = buildGroupFilter(req)
  return f ? { sql: `AND ${f.sql}`, params: f.params } : null
}

function buildScorecards(db, fixtureId, fixture, isOurTeam = _isOurTeamDefault) {
  const inningsList = db
    .prepare(`SELECT * FROM innings WHERE fixture_id = ? ORDER BY innings_order`)
    .all(fixtureId)

  const hasDeliveries = inningsList.some((inn) =>
    db.prepare(`SELECT 1 FROM deliveries WHERE result_id = ? LIMIT 1`).get(inn.result_id)
  )
  const hasManual =
    db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId)

  const scorecards =
    !hasDeliveries && hasManual
      ? buildManualScorecard(db, fixtureId, fixture.format, fixture.starting_score)
      : inningsList.map((inn) => {
          const firstBatterTeam =
            db
              .prepare(
                `SELECT p.team FROM deliveries d
              JOIN players p ON p.player_id = d.batter_id
              WHERE d.result_id = ? AND p.team IS NOT NULL LIMIT 1`
              )
              .get(inn.result_id)?.team ?? ''
          const ourBatting = isOurTeam(firstBatterTeam)
          return buildScorecard(
            db,
            fixtureId,
            inn.result_id,
            inn.innings_order,
            fixture.format,
            fixture.starting_score,
            ourBatting,
            fixture.max_overs || DEFAULT_OVERS
          )
        })

  return { scorecards, hasDeliveries }
}

function mvpFieldOrNull(showMvp, candidates) {
  if (!showMvp) return null
  return candidates.find((c) => c != null) ?? null
}

function attachSpells(db, fixtureId, scorecards) {
  const allSpells = getSpells(db, fixtureId)
  for (const sc of scorecards) {
    if (sc.isManual) continue
    for (const b of sc.bowling) {
      b.spells = allSpells.filter(
        (s) => s.innings_order === sc.inningsOrder && s.bowler_id === b.player_id
      )
    }
  }
}

function buildPartnershipsAndPhases(db, fixtureId, fixtureMaxOvers) {
  const detailCache = db
    .prepare('SELECT partnerships_json, phases_json FROM match_detail_cache WHERE fixture_id = ?')
    .get(fixtureId)
  if (detailCache) {
    return {
      partnerships: JSON.parse(detailCache.partnerships_json),
      phases: JSON.parse(detailCache.phases_json)
    }
  }
  const partnerships = getPartnerships(db, fixtureId)
  const phases = getPhaseStats(db, fixtureId, fixtureMaxOvers)
  db.prepare(
    'INSERT OR REPLACE INTO match_detail_cache (fixture_id, partnerships_json, phases_json, computed_at) VALUES (?, ?, ?, ?)'
  ).run(fixtureId, JSON.stringify(partnerships), JSON.stringify(phases), Date.now())
  return { partnerships, phases }
}

function buildMatchPlayers(scorecards) {
  const seen = new Map()
  for (const sc of scorecards) {
    for (const b of sc.batting || [])
      if (b.player_id && b.player_id > 0) seen.set(b.player_id, b.name)
    for (const b of sc.bowling || [])
      if (b.player_id && b.player_id > 0) seen.set(b.player_id, b.name)
  }
  return [...seen.entries()]
    .map(([player_id, name]) => ({ player_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function collectBatterIds(db, fixtureId, innings) {
  const batterIdsByInnings = {}
  for (const sc of innings) {
    const rows = db
      .prepare(
        `SELECT DISTINCT d.batter_id FROM deliveries d
         JOIN innings i ON i.result_id = d.result_id
         WHERE i.fixture_id = ? AND i.innings_order = ? AND d.batter_id > 0`
      )
      .all(fixtureId, sc.inningsOrder)
    batterIdsByInnings[sc.inningsOrder] = new Set(rows.map((r) => r.batter_id))
  }
  return batterIdsByInnings
}

function collectFielderIds(db, fixtureId, sc, otherBatters) {
  const bowlerIds = db
    .prepare(
      `SELECT DISTINCT d.bowler_id FROM deliveries d
       JOIN innings i ON i.result_id = d.result_id
       WHERE i.fixture_id = ? AND i.innings_order = ? AND d.bowler_id > 0`
    )
    .all(fixtureId, sc.inningsOrder)
    .map((r) => r.bowler_id)

  const fielderIds = db
    .prepare(
      `SELECT DISTINCT fielder_id FROM dismissals
       WHERE fixture_id = ? AND innings_order = ? AND fielder_id IS NOT NULL AND fielder_id > 0`
    )
    .all(fixtureId, sc.inningsOrder)
    .map((r) => r.fielder_id)

  return new Set([...bowlerIds, ...fielderIds, ...otherBatters])
}

// Per-innings player lists for the delivery editor.
// batters  = all players who faced a delivery in that innings
// fielders = all bowlers + all dismissal fielders in that innings
//            + all batters from every OTHER innings (the full fielding-side squad)
function resolvePlayerNames(db, allIds) {
  if (!allIds.size) return {}
  const ph = [...allIds].map(() => '?').join(',')
  const nameMap = {}
  for (const r of db
    .prepare(
      `SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${ph})`
    )
    .all(...allIds))
    nameMap[r.player_id] = r.name
  return nameMap
}

function gatherOtherBatters(innings, batterIdsByInnings, targetOrder) {
  const out = []
  for (const other of innings) {
    if (other.inningsOrder !== targetOrder) {
      for (const id of batterIdsByInnings[other.inningsOrder] ?? []) out.push(id)
    }
  }
  return out
}

function buildInningsPlayers(db, fixtureId, scorecards) {
  const sort = (arr) => [...arr].sort((a, b) => a.name.localeCompare(b.name))
  const innings = scorecards.filter((sc) => !sc.isManual)
  if (!innings.length) return {}

  const batterIdsByInnings = collectBatterIds(db, fixtureId, innings)
  const fielderIdsByInnings = {}
  for (const sc of innings) {
    const otherBatters = gatherOtherBatters(innings, batterIdsByInnings, sc.inningsOrder)
    fielderIdsByInnings[sc.inningsOrder] = collectFielderIds(db, fixtureId, sc, otherBatters)
  }

  const allIds = new Set([
    ...[...Object.values(batterIdsByInnings)].flatMap((s) => [...s]),
    ...[...Object.values(fielderIdsByInnings)].flatMap((s) => [...s])
  ])
  const nameMap = resolvePlayerNames(db, allIds)
  const toList = (ids) =>
    sort([...ids].filter((id) => nameMap[id]).map((id) => ({ player_id: id, name: nameMap[id] })))

  const result = {}
  for (const sc of innings) {
    result[sc.inningsOrder] = {
      batters: toList(batterIdsByInnings[sc.inningsOrder] ?? new Set()),
      fielders: toList(fielderIdsByInnings[sc.inningsOrder] ?? new Set())
    }
  }
  return result
}

function netPairsScore(score, wickets, ss) {
  return score - (ss ?? 200) - (wickets ?? 0) * 5
}

function pairsWickets(f, isOursHome) {
  const hw = Number(f.home_wickets) || 0
  const aw = Number(f.away_wickets) || 0
  return { ww: isOursHome ? hw : aw, ow: isOursHome ? aw : hw }
}

function classifyResult(ourScore, oppScore, format, f, isOursHome) {
  let ws = ourScore
  let os = oppScore
  if (format === 'pairs') {
    const ss = Number(f.starting_score) || 200
    const { ww, ow } = pairsWickets(f, isOursHome)
    ws = netPairsScore(ws, ww, ss)
    os = netPairsScore(os, ow, ss)
  }
  if (ws > os) return 'won'
  if (ws < os) return 'lost'
  return 'tied'
}

function fixtureScores(f) {
  const hs = Number(f.home_score)
  const as = Number(f.away_score)
  if (!f.home_score || !f.away_score || isNaN(hs) || isNaN(as)) return null
  return { hs, as }
}

function computeSeasonRecord(fixtures, isOurTeam = _isOurTeamDefault) {
  const isOurs = isOurTeam
  let won = 0,
    lost = 0,
    tied = 0,
    nrd = 0
  for (const f of fixtures) {
    const scores = fixtureScores(f)
    if (!scores) {
      nrd++
      continue
    }
    const isOursHome = isOurs(f.home_team)
    const res = classifyResult(
      isOursHome ? scores.hs : scores.as,
      isOursHome ? scores.as : scores.hs,
      f.format,
      f,
      isOursHome
    )
    if (res === 'won') won++
    else if (res === 'lost') lost++
    else tied++
  }
  return { played: fixtures.length, won, lost, tied, nrd }
}

function buildSeasonMatchScores(matchScoreFixtures, isOurTeam = _isOurTeamDefault) {
  const isOurs = isOurTeam
  return matchScoreFixtures.map((f) => {
    const isOursHome = isOurs(f.home_team)
    const hs = Number(f.home_score)
    const as = Number(f.away_score)
    const hw = Number(f.home_wickets)
    const aw = Number(f.away_wickets)
    const ss = Number(f.starting_score) || 200
    const ourScore = isOursHome ? hs : as
    const oppScore = isOursHome ? as : hs
    let result = 'nr'
    if (f.home_score && f.away_score && !isNaN(hs) && !isNaN(as)) {
      if (f.format === 'pairs') {
        const wNet = (isOursHome ? hs : as) - ss - (isOursHome ? hw : aw) * 5
        const oNet = (isOursHome ? as : hs) - ss - (isOursHome ? aw : hw) * 5
        if (wNet > oNet) result = 'won'
        else if (wNet < oNet) result = 'lost'
        else result = 'tied'
      } else {
        if (ourScore > oppScore) result = 'won'
        else if (ourScore < oppScore) result = 'lost'
        else result = 'tied'
      }
    }
    return {
      fixture_id: f.fixture_id,
      date: f.match_date_iso,
      our_score: isOursHome ? f.home_score : f.away_score,
      our_wickets: isOursHome ? f.home_wickets : f.away_wickets,
      opp_score: isOursHome ? f.away_score : f.home_score,
      opp_team: isOursHome ? f.away_team : f.home_team,
      result
    }
  })
}

function pickTopBatter(batRows, names) {
  const top = batRows.sort((a, b) => b.runs - a.runs)[0]
  const name = top ? (names[top.player_id] ?? null) : null
  return {
    ing_top_bat: name,
    ing_top_bat_runs: top ? top.runs : null,
    ing_top_bat_balls: top ? top.balls : null
  }
}

function pickTopBowler(bowlRows, names) {
  const top = bowlRows.sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0]
  const name = top ? (names[top.player_id] ?? null) : null
  return {
    ing_top_bowl: name,
    ing_top_bowl_wkts: top ? top.wickets : null,
    ing_top_bowl_runs: top ? top.runs : null
  }
}

function pickMvp(mvpPts, names) {
  const entries = Object.entries(mvpPts).sort((a, b) => b[1] - a[1])
  const top = entries[0]
  const name = top ? (names[top[0]] ?? null) : null
  const pts = top ? +top[1].toFixed(1) : null
  return { ing_top_mvp_cached: name, ing_top_mvp_pts_cached: pts }
}

function selectTopStats(data, names) {
  return {
    ...pickTopBatter(data.bat, names),
    ...pickTopBowler(data.bowl, names),
    ...pickMvp(data.mvpPts, names)
  }
}

function queryBatRows(db, fixtureIds, colWhere) {
  const ph = fixtureIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT i.fixture_id, d.batter_id AS player_id,
        SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls
       FROM deliveries d
       JOIN innings i ON i.result_id = d.result_id
       JOIN players_dn p ON p.player_id = d.batter_id
       WHERE i.fixture_id IN (${ph}) AND ${colWhere('p.team')}
       GROUP BY i.fixture_id, d.batter_id`
    )
    .all(...fixtureIds)
}

function queryBowlRows(db, fixtureIds, colWhere) {
  const ph = fixtureIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT i.fixture_id, d.bowler_id AS player_id,
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS wickets,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
       FROM deliveries d
       JOIN innings i ON i.result_id = d.result_id
       JOIN players_dn p ON p.player_id = d.bowler_id
       LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                                AND dis.batter_id = d.dismissed_batter_id
                                AND dis.innings_order = i.innings_order
       WHERE i.fixture_id IN (${ph}) AND ${colWhere('p.team')}
       GROUP BY i.fixture_id, d.bowler_id`
    )
    .all(...fixtureIds)
}

// Compute top bat / top bowl / MVP for a batch of delivery-based fixtures using
// the given colWhere club filter. Used when the match_stats_cache holds WHCC-biased data.
function computeClubStatsForFixtures(db, fixtureIds, colWhere) {
  if (!fixtureIds.length) return {}

  const batRows = queryBatRows(db, fixtureIds, colWhere)
  const bowlRows = queryBowlRows(db, fixtureIds, colWhere)

  const playerIds = [...new Set([...batRows, ...bowlRows].map((r) => r.player_id))]
  const namePh = playerIds.map(() => '?').join(',')
  const names = playerIds.length
    ? Object.fromEntries(
        db
          .prepare(
            `SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${namePh})`
          )
          .all(...playerIds)
          .map((r) => [r.player_id, r.name])
      )
    : {}

  const byFixture = {}
  for (const r of batRows) {
    const f = (byFixture[r.fixture_id] ??= { bat: [], bowl: [], mvpPts: {} })
    f.bat.push(r)
    f.mvpPts[r.player_id] = (f.mvpPts[r.player_id] || 0) + r.runs * 0.1
  }
  for (const r of bowlRows) {
    const f = (byFixture[r.fixture_id] ??= { bat: [], bowl: [], mvpPts: {} })
    f.bowl.push(r)
    f.mvpPts[r.player_id] = (f.mvpPts[r.player_id] || 0) + bowlerMvpPoints(r.wickets)
  }

  const result = {}
  for (const [fid, data] of Object.entries(byFixture)) {
    result[fid] = selectTopStats(data, names)
  }
  return result
}

function getMatchList(db, req, limit, offset) {
  const { clubId: listClubId } = getAuthContext(req)
  const { colWhere: listColWhere } = getClubFilters(db, listClubId)
  const isNonWhcc = listClubId != null && listClubId !== 1
  const showMvp = getClubShowMvp(db, listClubId)

  const accessFilter = buildAccessFilter(req)
  const groupFilter = groupFilterClause(req)
  const whereClauses = [
    accessFilter ? `(${accessFilter.sql})` : null,
    groupFilter ? groupFilter.sql.replace(/^AND /, '') : null
  ].filter(Boolean)
  const accessWhere = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const accessParams = [...(accessFilter?.params ?? []), ...(groupFilter?.params ?? [])]

  const FIXTURE_SELECT = `
    SELECT f.*,
      COUNT(DISTINCT i.result_id) as innings_count,
      COUNT(d.id) as total_deliveries,
      (SELECT COALESCE(SUM(mb.runs), 0) + COALESCE((SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id) as manual_runs,
      (SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id) as manual_extras,
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.not_out = 0 AND mb.did_not_bat = 0) as manual_wkts,
      (SELECT SUM(mbw.wickets) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_bowl_wkts,
      (SELECT COALESCE(SUM(mbw.runs), 0) + COALESCE((SELECT me.bowling_byes + me.bowling_leg_byes FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_opp_runs,
      COALESCE(
        (SELECT me.our_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.our_overs IS NOT NULL AND me.our_overs != ''),
        (SELECT CASE WHEN SUM(mb.balls) > 0 THEN CAST(SUM(mb.balls)/6 AS TEXT)||'.'||CAST(SUM(mb.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0)
      ) as manual_our_overs,
      COALESCE(
        (SELECT me.opp_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.opp_overs IS NOT NULL AND me.opp_overs != ''),
        (SELECT CASE WHEN SUM(mbw.balls) > 0 THEN CAST(SUM(mbw.balls)/6 AS TEXT)||'.'||CAST(SUM(mbw.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id)
      ) as manual_opp_overs,
      (SELECT p.name FROM manual_batting mb JOIN players_dn p ON p.player_id = mb.player_id
       WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat,
      (SELECT mb.runs FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_runs,
      (SELECT mb.balls FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_balls,
      (SELECT p.name FROM manual_bowling mbw JOIN players_dn p ON p.player_id = mbw.player_id
       WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl,
      (SELECT mbw.wickets FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_wkts,
      (SELECT mbw.runs FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_runs,
      msc.top_bat_name     AS ing_top_bat,
      msc.top_bat_runs     AS ing_top_bat_runs,
      msc.top_bat_balls    AS ing_top_bat_balls,
      msc.top_bowl_name    AS ing_top_bowl,
      msc.top_bowl_wickets AS ing_top_bowl_wkts,
      msc.top_bowl_runs    AS ing_top_bowl_runs,
      msc.mvp_name         AS ing_top_mvp_cached,
      msc.mvp_pts          AS ing_top_mvp_pts_cached,
      (SELECT COUNT(DISTINCT d3.batter_id) FROM innings i3 JOIN deliveries d3 ON d3.result_id = i3.result_id
       WHERE i3.fixture_id = f.fixture_id AND i3.innings_order = 1) AS inn1_batters,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT SUM(d2.runs_bat + d2.runs_extra) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 1) END AS inn1_runs,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT COUNT(*) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 1 AND d2.dismissed_batter_id IS NOT NULL) END AS inn1_wkts,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT SUM(d2.runs_bat + d2.runs_extra) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 2) END AS inn2_runs,
      CASE WHEN f.home_score IS NULL THEN
        (SELECT COUNT(*) FROM innings i2 JOIN deliveries d2 ON d2.result_id = i2.result_id
         WHERE i2.fixture_id = f.fixture_id AND i2.innings_order = 2 AND d2.dismissed_batter_id IS NOT NULL) END AS inn2_wkts,
      (${tagsSubquery('f.fixture_id')}) AS tags_csv
    FROM fixtures f
    LEFT JOIN innings i ON i.fixture_id = f.fixture_id
    LEFT JOIN deliveries d ON d.result_id = i.result_id
    LEFT JOIN match_stats_cache msc ON msc.fixture_id = f.fixture_id
    ${accessWhere}
    GROUP BY f.fixture_id
    ORDER BY f.match_date_iso DESC, f.fixture_id DESC
  `

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM (${FIXTURE_SELECT})`)
    .get(...accessParams)

  const fixtures = db
    .prepare(`${FIXTURE_SELECT} LIMIT ? OFFSET ?`)
    .all(...accessParams, limit, offset)

  const uncachedManual = showMvp
    ? fixtures
        .filter(
          (f) => f.total_deliveries === 0 && f.manual_runs !== null && f.ing_top_mvp_cached === null
        )
        .map((f) => f.fixture_id)
    : []
  const fallbackMvp = uncachedManual.length ? computeManualMvpForFixtures(db, uncachedManual) : {}

  // For non-WHCC clubs the match_stats_cache holds WHCC player data — recompute fresh
  const clubStatsOverride = isNonWhcc
    ? computeClubStatsForFixtures(
        db,
        fixtures.filter((f) => f.total_deliveries > 0).map((f) => f.fixture_id),
        listColWhere
      )
    : {}

  const matches = fixtures.map((f) => {
    let { home_score, away_score, home_wickets, away_wickets, result } = f
    if (home_score === null && f.inn1_runs !== null) {
      const homeWonToss =
        f.toss_winner &&
        f.home_team &&
        f.toss_winner.toLowerCase().includes(f.home_team.split(' ')[0].toLowerCase())
      const inn1IsHome =
        (homeWonToss && f.toss_decision === 'bat') || (!homeWonToss && f.toss_decision === 'field')
      home_score = String(inn1IsHome ? f.inn1_runs : (f.inn2_runs ?? 0))
      away_score = String(inn1IsHome ? f.inn2_runs : (f.inn1_runs ?? 0))
      home_wickets = String(inn1IsHome ? f.inn1_wkts : (f.inn2_wkts ?? 0))
      away_wickets = String(inn1IsHome ? f.inn2_wkts : (f.inn1_wkts ?? 0))
      result = 'In Progress'
    }
    return {
      ...f,
      home_score,
      away_score,
      home_wickets,
      away_wickets,
      result,
      ...(clubStatsOverride[f.fixture_id] ?? {}),
      ing_top_mvp: mvpFieldOrNull(showMvp, [
        clubStatsOverride[f.fixture_id]?.ing_top_mvp_cached,
        f.ing_top_mvp_cached,
        fallbackMvp[f.fixture_id]?.name
      ]),
      ing_top_mvp_pts: mvpFieldOrNull(showMvp, [
        clubStatsOverride[f.fixture_id]?.ing_top_mvp_pts_cached,
        f.ing_top_mvp_pts_cached,
        fallbackMvp[f.fixture_id]?.pts
      ]),
      tags: f.tags_csv ? f.tags_csv.split(',') : [f.match_type || 'league']
    }
  })
  return { matches, total, limit, offset }
}

function getSeasonStats(db, req) {
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const types = parseTypes(req.query.types)

  const { clubId: seasonClubId } = getAuthContext(req)
  const { fixtureWhere, fixtureParams, colWhere, isOurTeam } = getClubFilters(db, seasonClubId)

  const _ye = _yearExpr()
  const yearClause = year ? `AND ${_ye} = ?` : ''
  const yearParams = year ? [year] : []

  // Club-specific sub-team clause (mirrors ourTeamClause but uses club markers)
  const clubTeamClause = team
    ? {
        clause: `AND ((lower(f.home_team) LIKE ? AND ${colWhere('f.home_team')})
                 OR (lower(f.away_team) LIKE ? AND ${colWhere('f.away_team')}))`,
        params: [`%${team}%`, `%${team}%`]
      }
    : { clause: '', params: [] }
  const { clause: compFilter, params: compParams } = typesClause(types)
  const formatParam = req.query.format
  const formatClause =
    formatParam === 'pairs'
      ? "AND f.format = 'pairs'"
      : formatParam === 'no-pairs'
        ? "AND COALESCE(f.format,'') != 'pairs'"
        : ''

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []
  const groupFilter = groupFilterClause(req)
  const groupClause = groupFilter?.sql ?? ''
  const groupParams = groupFilter?.params ?? []
  const rfSub = `SELECT f.fixture_id FROM fixtures f WHERE ${fixtureWhere} ${yearClause} ${clubTeamClause.clause} ${compFilter} ${formatClause} ${accessClause} ${groupClause}`
  const rfParams = [
    ...fixtureParams,
    ...yearParams,
    ...clubTeamClause.params,
    ...compParams,
    ...accessParams,
    ...groupParams
  ]

  const fixtures = db
    .prepare(
      `SELECT f.fixture_id, f.home_team, f.away_team, f.home_score, f.away_score,
      f.home_wickets, f.away_wickets, f.toss_winner, f.toss_decision,
      f.format, f.starting_score,
      (SELECT COUNT(DISTINCT d.batter_id) FROM innings i JOIN deliveries d ON d.result_id = i.result_id
        WHERE i.fixture_id = f.fixture_id AND i.innings_order = 1) AS inn1_batters
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})`
    )
    .all(...rfParams)

  const batRow = db
    .prepare(
      `SELECT SUM(runs) AS total_runs, SUM(outs) AS total_outs, SUM(balls) AS total_balls
    FROM (
      SELECT SUM(d.runs_bat) AS runs,
        SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS outs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.batter_id, d.result_id
      UNION ALL
      SELECT mb.runs, CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END, mb.balls
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
    )`
    )
    .get(...rfParams, ...rfParams)

  const bowlRow = db
    .prepare(
      `SELECT SUM(wickets) AS total_wickets, SUM(legal_balls) AS total_balls, SUM(runs) AS total_runs
    FROM (
      SELECT
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.bowler_id, d.result_id
      UNION ALL
      SELECT mbw.wickets, mbw.balls, mbw.runs
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
    )`
    )
    .get(...rfParams, ...rfParams)

  const topBatterRows = db
    .prepare(
      `SELECT p.player_id, p.name,
      SUM(t.total_runs) AS total_runs,
      SUM(t.total_outs) AS total_outs
    FROM (
      SELECT d.batter_id AS player_id, SUM(d.runs_bat) AS total_runs,
        SUM(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) AS total_outs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.batter_id
      UNION ALL
      SELECT mb.player_id, SUM(mb.runs),
        SUM(CASE WHEN mb.not_out = 0 THEN 1 ELSE 0 END)
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
      GROUP BY mb.player_id
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.total_runs) DESC LIMIT 3`
    )
    .all(...rfParams, ...rfParams)

  const topBowlerRows = db
    .prepare(
      `SELECT p.player_id, p.name,
      SUM(t.total_wickets) AS total_wickets,
      SUM(t.total_balls) AS total_balls,
      SUM(t.total_runs) AS total_runs
    FROM (
      SELECT d.bowler_id AS player_id,
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS total_wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS total_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS total_runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.bowler_id
      UNION ALL
      SELECT mbw.player_id, SUM(mbw.wickets), SUM(mbw.balls), SUM(mbw.runs)
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
      GROUP BY mbw.player_id
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    GROUP BY p.player_id
    ORDER BY SUM(t.total_wickets) DESC LIMIT 3`
    )
    .all(...rfParams, ...rfParams)

  const highScoreRow = db
    .prepare(
      `SELECT p.player_id, p.name,
      MAX(t.runs) AS score,
      t.not_out,
      f.fixture_id, f.home_team, f.away_team, f.match_date_iso
    FROM (
      SELECT d.batter_id AS player_id,
        SUM(d.runs_bat) AS runs,
        CASE WHEN MAX(CASE WHEN d.dismissed_batter_id = d.batter_id THEN 1 ELSE 0 END) = 0 THEN 1 ELSE 0 END AS not_out,
        i.fixture_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.batter_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.batter_id, i.fixture_id
      UNION ALL
      SELECT mb.player_id, mb.runs, mb.not_out, mb.fixture_id
      FROM manual_batting mb
      WHERE mb.fixture_id IN (${rfSub}) AND mb.did_not_bat = 0
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    JOIN fixtures f ON f.fixture_id = t.fixture_id
    ORDER BY t.runs DESC LIMIT 1`
    )
    .get(...rfParams, ...rfParams)

  const bestBowlingRow = db
    .prepare(
      `SELECT p.player_id, p.name,
      t.wickets, t.runs, t.balls,
      f.fixture_id, f.home_team, f.away_team, f.match_date_iso
    FROM (
      SELECT d.bowler_id AS player_id,
        SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
                 AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
            THEN 1 ELSE 0 END) AS wickets,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls,
        i.fixture_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                               AND dis.batter_id = d.dismissed_batter_id
                               AND dis.innings_order = i.innings_order
      WHERE i.fixture_id IN (${rfSub})
        AND ${colWhere('pb.team')}
      GROUP BY d.bowler_id, i.fixture_id
      UNION ALL
      SELECT mbw.player_id, mbw.wickets, mbw.runs, mbw.balls, mbw.fixture_id
      FROM manual_bowling mbw
      WHERE mbw.fixture_id IN (${rfSub})
      GROUP BY mbw.player_id, mbw.fixture_id
    ) t
    JOIN players_dn p ON p.player_id = t.player_id
    JOIN fixtures f ON f.fixture_id = t.fixture_id
    WHERE t.wickets > 0
    ORDER BY t.wickets DESC, t.runs ASC LIMIT 1`
    )
    .get(...rfParams, ...rfParams)

  const bestMvpRow = getClubShowMvp(db, seasonClubId)
    ? db
        .prepare(
          `SELECT msc.mvp_name AS name, CAST(msc.mvp_pts AS REAL) AS pts,
          p.player_id,
          f.fixture_id, f.home_team, f.away_team, f.match_date_iso
        FROM match_stats_cache msc
        JOIN fixtures f ON f.fixture_id = msc.fixture_id
        LEFT JOIN players_dn p ON p.name = msc.mvp_name
        WHERE msc.fixture_id IN (${rfSub})
          AND msc.mvp_name IS NOT NULL AND msc.mvp_pts IS NOT NULL
        ORDER BY CAST(msc.mvp_pts AS REAL) DESC LIMIT 1`
        )
        .get(...rfParams)
    : null

  const matchScoreFixtures = db
    .prepare(
      `SELECT f.fixture_id, f.match_date_iso, f.home_team, f.away_team,
      f.home_score, f.away_score, f.home_wickets, f.away_wickets,
      f.format, f.starting_score
    FROM fixtures f WHERE f.fixture_id IN (${rfSub})
    AND f.match_date_iso IS NOT NULL
    ORDER BY f.match_date_iso ASC`
    )
    .all(...rfParams)

  const years = db
    .prepare(
      `SELECT DISTINCT substr(f.match_date_iso, 1, 4) AS year FROM fixtures f
    WHERE ${fixtureWhere} AND f.match_date_iso IS NOT NULL
    ORDER BY year DESC`
    )
    .all(...fixtureParams)
    .map((r) => r.year)

  const totalRuns = batRow?.total_runs || 0
  const totalOuts = batRow?.total_outs || 0
  const totalBatBalls = batRow?.total_balls || 0
  const totalWkts = bowlRow?.total_wickets || 0
  const totalBowlBalls = bowlRow?.total_balls || 0
  const totalBowlRuns = bowlRow?.total_runs || 0

  return {
    record: computeSeasonRecord(fixtures, isOurTeam),
    batting: {
      total_runs: totalRuns,
      bat_avg: totalOuts > 0 ? (totalRuns / totalOuts).toFixed(2) : null,
      run_rate: totalBatBalls > 0 ? ((totalRuns / totalBatBalls) * 6).toFixed(2) : null
    },
    bowling: {
      total_wickets: totalWkts,
      bowl_avg: totalWkts > 0 ? (totalBowlRuns / totalWkts).toFixed(2) : null,
      economy: totalBowlBalls > 0 ? ((totalBowlRuns / totalBowlBalls) * 6).toFixed(2) : null
    },
    top_batters: topBatterRows.map((r) => ({
      player_id: r.player_id,
      name: r.name,
      runs: r.total_runs,
      average: r.total_outs > 0 ? (r.total_runs / r.total_outs).toFixed(1) : null
    })),
    top_bowlers: topBowlerRows.map((r) => ({
      player_id: r.player_id,
      name: r.name,
      wickets: r.total_wickets,
      economy: r.total_balls > 0 ? ((r.total_runs / r.total_balls) * 6).toFixed(1) : null
    })),
    match_scores: buildSeasonMatchScores(matchScoreFixtures, isOurTeam),
    years,
    highlights: {
      high_score: highScoreRow
        ? {
            player_id: highScoreRow.player_id,
            name: highScoreRow.name,
            score: highScoreRow.score,
            not_out: highScoreRow.not_out,
            fixture_id: highScoreRow.fixture_id,
            opponent: highScoreRow.home_team,
            home_team: highScoreRow.home_team,
            away_team: highScoreRow.away_team
          }
        : null,
      best_bowling: bestBowlingRow
        ? {
            player_id: bestBowlingRow.player_id,
            name: bestBowlingRow.name,
            wickets: bestBowlingRow.wickets,
            runs: bestBowlingRow.runs,
            balls: bestBowlingRow.balls,
            fixture_id: bestBowlingRow.fixture_id,
            home_team: bestBowlingRow.home_team,
            away_team: bestBowlingRow.away_team
          }
        : null,
      best_mvp: bestMvpRow
        ? {
            player_id: bestMvpRow.player_id,
            name: bestMvpRow.name,
            pts: bestMvpRow.pts,
            fixture_id: bestMvpRow.fixture_id,
            home_team: bestMvpRow.home_team,
            away_team: bestMvpRow.away_team
          }
        : null
    }
  }
}

function buildJerseyNumbers(db, scorecards, mvp) {
  const ids = new Set(
    [
      ...scorecards.flatMap((sc) => [
        ...sc.batting.map((b) => b.player_id),
        ...sc.bowling.map((b) => b.player_id)
      ]),
      ...mvp.map((p) => p.playerId)
    ].filter((id) => id > 0)
  )
  if (!ids.size) return {}
  const ph = [...ids].map(() => '?').join(',')
  return Object.fromEntries(
    db
      .prepare(
        `SELECT player_id, jersey_number FROM players WHERE player_id IN (${ph}) AND jersey_number IS NOT NULL`
      )
      .all(...ids)
      .map((r) => [r.player_id, r.jersey_number])
  )
}

function getMatchDetail(db, fixtureId, req) {
  const af = buildAccessFilter(req)
  const fixture = db
    .prepare(
      `SELECT f.*,
      (SELECT MAX(i.ingested_at) FROM ingests i WHERE i.fixture_id = f.fixture_id) AS last_ingested_at,
      (SELECT i.clerk_user_name FROM ingests i WHERE i.fixture_id = f.fixture_id ORDER BY i.ingested_at DESC LIMIT 1) AS last_ingested_by
    FROM fixtures f WHERE f.fixture_id = ?${af ? ` AND (${af.sql})` : ''}`
    )
    .get(fixtureId, ...(af?.params ?? []))
  if (!fixture) return null

  const { clubId } = getAuthContext(req)
  const { isOurTeam, colWhere } = getClubFilters(db, clubId)

  const { scorecards, hasDeliveries } = buildScorecards(db, fixtureId, fixture, isOurTeam)

  const ourNames = db
    .prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE ${colWhere('team')}`)
    .all()
    .map((r) => r.name)

  const fixtureMaxOvers = fixture.max_overs || DEFAULT_OVERS

  const { mvp, mvpMeta } = buildMvpForFixture(
    db,
    fixtureId,
    scorecards,
    hasDeliveries,
    fixtureMaxOvers,
    colWhere,
    clubId
  )

  if (hasDeliveries) {
    attachSpells(db, fixtureId, scorecards)
  }

  let partnerships = []
  let phases = []
  if (hasDeliveries) {
    ;({ partnerships, phases } = buildPartnershipsAndPhases(db, fixtureId, fixtureMaxOvers))
  }

  const matchPlayers = buildMatchPlayers(scorecards)
  const inningsPlayers = buildInningsPlayers(db, fixtureId, scorecards)
  const jerseyNumbers = buildJerseyNumbers(db, scorecards, mvp)
  return {
    fixture,
    scorecards,
    ourNames,
    mvp,
    mvpMeta,
    partnerships,
    phases,
    matchPlayers,
    inningsPlayers,
    jerseyNumbers
  }
}

function getMatchRoles(db, fixtureId, req) {
  const inningsList = db
    .prepare(
      `SELECT i.result_id, i.innings_order FROM innings i WHERE i.fixture_id = ? ORDER BY i.innings_order`
    )
    .all(fixtureId)

  if (!inningsList.length) return {}

  const captains = db
    .prepare(`SELECT innings_order, player_id FROM match_captains WHERE fixture_id = ?`)
    .all(fixtureId)
  const captainMap = Object.fromEntries(captains.map((c) => [c.innings_order, c.player_id]))

  const wkRows = db
    .prepare(
      `SELECT id, innings_order, player_id, from_over, to_over FROM wk_assignments WHERE fixture_id = ? ORDER BY innings_order, from_over`
    )
    .all(fixtureId)

  const errorRows = db
    .prepare(`SELECT id, innings_order, player_id, error_type FROM wk_errors WHERE fixture_id = ?`)
    .all(fixtureId)

  const { clubId: rolesClubId } = req ? getAuthContext(req) : { clubId: null }
  const { isOurTeam: isOursName, colWhere: rolesColWhere } = getClubFilters(db, rolesClubId)

  const fixtureTeams = db
    .prepare('SELECT home_team, away_team FROM fixtures WHERE fixture_id = ?')
    .get(fixtureId)
  const ourFixtureTeam = fixtureTeams
    ? ([fixtureTeams.home_team, fixtureTeams.away_team].find(isOursName) ?? null)
    : null
  const oppFixtureTeam = fixtureTeams
    ? ([fixtureTeams.home_team, fixtureTeams.away_team].find((t) => !isOursName(t)) ?? null)
    : null

  const isManualFixture = !!(
    db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId)
  )

  const result = {}

  for (const inn of inningsList) {
    const order = inn.innings_order

    const btRow = db
      .prepare(
        `SELECT p.team FROM deliveries d JOIN players_dn p ON p.player_id = d.batter_id WHERE d.result_id = ? ORDER BY d.over_no, d.ball_no LIMIT 1`
      )
      .get(inn.result_id)
    const batting_team =
      btRow?.team ?? (isManualFixture ? (order === 1 ? ourFixtureTeam : oppFixtureTeam) : null)

    const otherResultId =
      inningsList.find((i) => i.innings_order !== order)?.result_id ?? inn.result_id
    let players
    if (isManualFixture) {
      players =
        order === 1
          ? db
              .prepare(
                `SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_batting mb ON mb.player_id = p.player_id WHERE mb.fixture_id = ? ORDER BY p.name`
              )
              .all(fixtureId)
          : db
              .prepare(
                `SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_bowling mbw ON mbw.player_id = p.player_id WHERE mbw.fixture_id = ? ORDER BY p.name`
              )
              .all(fixtureId)
    } else {
      const isOursBatting = isOursName(batting_team)
      const ourTeamFilter = rolesColWhere('p.team')
      const teamFilter =
        batting_team === null
          ? ''
          : isOursBatting
            ? `AND ${ourTeamFilter}`
            : `AND NOT ${ourTeamFilter}`
      players = db
        .prepare(
          `SELECT DISTINCT p.player_id, COALESCE(p.display_name, p.name) AS name FROM players p
          WHERE p.player_id IN (
            SELECT batter_id  FROM deliveries WHERE result_id = ?
            UNION
            SELECT bowler_id  FROM deliveries WHERE result_id = ?
            UNION
            SELECT pf.player_id FROM player_flags pf WHERE pf.fixture_id = ?
            UNION
            SELECT d.fielder_id FROM dismissals d WHERE d.fixture_id = ? AND d.fielder_id IS NOT NULL
            UNION
            SELECT wa.player_id FROM wk_assignments wa WHERE wa.fixture_id = ?
          )
          ${teamFilter}
          ORDER BY COALESCE(p.display_name, p.name)`
        )
        .all(inn.result_id, otherResultId, fixtureId, fixtureId, fixtureId)
    }

    const stints = wkRows.filter((r) => r.innings_order === order)
    const errors = errorRows.filter((r) => r.innings_order === order)

    const allByes = db
      .prepare(`SELECT over_no, runs_extra FROM deliveries WHERE result_id = ? AND extras_type = 3`)
      .all(inn.result_id)
    const byesInRange = (fromOver, toOver) =>
      allByes
        .filter((r) => r.over_no >= fromOver - 1 && (toOver === null || r.over_no <= toOver - 1))
        .reduce((s, r) => s + r.runs_extra, 0)

    const wk_stints = stints.map((stint, idx) => {
      const nextFrom = stints[idx + 1]?.from_over ?? null
      const toOver = stint.to_over ?? nextFrom ?? null
      return {
        id: stint.id,
        player_id: stint.player_id,
        from_over: stint.from_over,
        to_over: stint.to_over ?? null,
        byes: byesInRange(stint.from_over, toOver)
      }
    })

    result[order] = {
      captain_player_id: captainMap[order] ?? null,
      batting_team: isOursName(batting_team)
        ? (ourFixtureTeam ?? batting_team)
        : (oppFixtureTeam ?? batting_team),
      wk_stints,
      wk_errors: errors,
      players
    }
  }

  return result
}

module.exports = {
  groupFilterClause,
  buildScorecards,
  buildMvpForFixture,
  attachSpells,
  buildPartnershipsAndPhases,
  buildMatchPlayers,
  computeSeasonRecord,
  buildSeasonMatchScores,
  getMatchList,
  getSeasonStats,
  getMatchDetail,
  getMatchRoles
}
