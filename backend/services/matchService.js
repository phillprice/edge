'use strict'

const { tagsSubquery } = require('../utils/tags')

const {
  whccFixtureWhere,
  whccCol,
  whccTeamClause,
  isWhccTeam,
  yearExpr: _yearExpr
} = require('../utils/db')
const { buildAccessFilter, buildGroupFilter } = require('../utils/access')
const {
  getPartnerships,
  getPhaseStats,
  getSpells,
  buildManualScorecard,
  buildScorecard
} = require('../utils/scorecard')
const { buildManualMvp, computeManualMvpForFixtures, buildMvp } = require('../utils/mvp')
const { parseComp, compClause } = require('../utils/competitionFilter')

const DEFAULT_OVERS = 20

function groupFilterClause(req) {
  const f = buildGroupFilter(req)
  return f ? { sql: `AND ${f.sql}`, params: f.params } : null
}

function buildScorecards(db, fixtureId, fixture) {
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
          const whccBatting = isWhccTeam(firstBatterTeam)
          return buildScorecard(
            db,
            fixtureId,
            inn.result_id,
            inn.innings_order,
            fixture.format,
            fixture.starting_score,
            whccBatting,
            fixture.max_overs || DEFAULT_OVERS
          )
        })

  return { scorecards, hasDeliveries }
}

function buildMvpForFixture(db, fixtureId, scorecards, hasDeliveries, fixtureMaxOvers) {
  const isManualMatch = scorecards.some((sc) => sc.isManual)
  let mvp, mvpMeta
  if (isManualMatch) {
    const cachedMvp = db
      .prepare('SELECT players_json FROM mvp_cache WHERE fixture_id = ?')
      .get(fixtureId)
    if (cachedMvp) {
      mvp = JSON.parse(cachedMvp.players_json)
    } else {
      mvp = buildManualMvp(db, fixtureId)
      if (mvp.length) {
        db.prepare(
          'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
        ).run(fixtureId, JSON.stringify(mvp), JSON.stringify(null), Date.now())
      }
    }
    mvpMeta = null
  } else if (!hasDeliveries) {
    mvp = []
    mvpMeta = null
  } else {
    const cached = db
      .prepare('SELECT players_json, meta_json FROM mvp_cache WHERE fixture_id = ?')
      .get(fixtureId)
    if (cached) {
      mvp = JSON.parse(cached.players_json)
      mvpMeta = JSON.parse(cached.meta_json)
    } else {
      const mvpResult = buildMvp(db, fixtureId, scorecards, fixtureMaxOvers)
      mvp = mvpResult?.players ?? []
      mvpMeta = mvpResult?.meta ?? null
      if (mvpResult) {
        db.prepare(
          'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
        ).run(fixtureId, JSON.stringify(mvp), JSON.stringify(mvpMeta), Date.now())
      }
    }
  }
  return { mvp, mvpMeta }
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

function computeSeasonRecord(fixtures) {
  const isWhcc = isWhccTeam
  function netScore(score, wickets, ss) {
    return score - (ss ?? 200) - (wickets ?? 0) * 5
  }
  let won = 0,
    lost = 0,
    tied = 0,
    nrd = 0
  for (const f of fixtures) {
    const hs = Number(f.home_score),
      as = Number(f.away_score)
    if (!f.home_score || !f.away_score || isNaN(hs) || isNaN(as)) {
      nrd++
      continue
    }
    const isWhccHome = isWhcc(f.home_team)
    let whccScore = isWhccHome ? hs : as
    let oppScore = isWhccHome ? as : hs
    if (f.format === 'pairs') {
      const ss = Number(f.starting_score) || 200
      const ww = Number(isWhccHome ? f.home_wickets : f.away_wickets) || 0
      const ow = Number(isWhccHome ? f.away_wickets : f.home_wickets) || 0
      whccScore = netScore(whccScore, ww, ss)
      oppScore = netScore(oppScore, ow, ss)
    }
    if (whccScore > oppScore) won++
    else if (whccScore < oppScore) lost++
    else tied++
  }
  return { played: fixtures.length, won, lost, tied, nrd }
}

function buildSeasonMatchScores(matchScoreFixtures) {
  const isWhcc = isWhccTeam
  return matchScoreFixtures.map((f) => {
    const isWhccHome = isWhcc(f.home_team)
    const hs = Number(f.home_score)
    const as = Number(f.away_score)
    const hw = Number(f.home_wickets)
    const aw = Number(f.away_wickets)
    const ss = Number(f.starting_score) || 200
    const whccScore = isWhccHome ? hs : as
    const oppScore = isWhccHome ? as : hs
    let result = 'nr'
    if (f.home_score && f.away_score && !isNaN(hs) && !isNaN(as)) {
      if (f.format === 'pairs') {
        const wNet = (isWhccHome ? hs : as) - ss - (isWhccHome ? hw : aw) * 5
        const oNet = (isWhccHome ? as : hs) - ss - (isWhccHome ? aw : hw) * 5
        if (wNet > oNet) result = 'won'
        else if (wNet < oNet) result = 'lost'
        else result = 'tied'
      } else {
        if (whccScore > oppScore) result = 'won'
        else if (whccScore < oppScore) result = 'lost'
        else result = 'tied'
      }
    }
    return {
      fixture_id: f.fixture_id,
      date: f.match_date_iso,
      whcc_score: isWhccHome ? f.home_score : f.away_score,
      whcc_wickets: isWhccHome ? f.home_wickets : f.away_wickets,
      opp_score: isWhccHome ? f.away_score : f.home_score,
      opp_team: isWhccHome ? f.away_team : f.home_team,
      result
    }
  })
}

function getMatchList(db, req, limit, offset) {
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
        (SELECT me.whcc_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.whcc_overs IS NOT NULL AND me.whcc_overs != ''),
        (SELECT CASE WHEN SUM(mb.balls) > 0 THEN CAST(SUM(mb.balls)/6 AS TEXT)||'.'||CAST(SUM(mb.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0)
      ) as manual_whcc_overs,
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

  const uncachedManual = fixtures
    .filter(
      (f) => f.total_deliveries === 0 && f.manual_runs !== null && f.ing_top_mvp_cached === null
    )
    .map((f) => f.fixture_id)
  const fallbackMvp = uncachedManual.length ? computeManualMvpForFixtures(db, uncachedManual) : {}
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
      ing_top_mvp: f.ing_top_mvp_cached ?? fallbackMvp[f.fixture_id]?.name ?? null,
      ing_top_mvp_pts: f.ing_top_mvp_pts_cached ?? fallbackMvp[f.fixture_id]?.pts ?? null,
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
  const comp = parseComp(req.query.comp)

  const _ye = _yearExpr()
  const yearClause = year ? `AND ${_ye} = ?` : ''
  const yearParams = year ? [year] : []

  const whccWhere = whccFixtureWhere()
  const { clause: teamClause, params: teamParams } = whccTeamClause(team)
  const { clause: compFilter } = compClause(comp)

  const accessFilter = buildAccessFilter(req)
  const accessClause = accessFilter ? `AND (${accessFilter.sql})` : ''
  const accessParams = accessFilter?.params ?? []
  const groupFilter = groupFilterClause(req)
  const groupClause = groupFilter?.sql ?? ''
  const groupParams = groupFilter?.params ?? []
  const rfSub = `SELECT f.fixture_id FROM fixtures f WHERE ${whccWhere} ${yearClause} ${teamClause} ${compFilter} ${accessClause} ${groupClause}`
  const rfParams = [...yearParams, ...teamParams, ...accessParams, ...groupParams]

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
        AND ${whccCol('pb.team')}
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
      SELECT COUNT(d.dismissed_batter_id) AS wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${whccCol('pb.team')}
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
        AND ${whccCol('pb.team')}
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
        COUNT(d.dismissed_batter_id) AS total_wickets,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS total_balls,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS total_runs
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${whccCol('pb.team')}
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
        AND ${whccCol('pb.team')}
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
        COUNT(d.dismissed_batter_id) AS wickets,
        SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
        SUM(CASE WHEN COALESCE(d.extras_type,0) NOT IN (1,2) THEN 1 ELSE 0 END) AS balls,
        i.fixture_id
      FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      JOIN players_dn pb ON pb.player_id = d.bowler_id
      WHERE i.fixture_id IN (${rfSub})
        AND ${whccCol('pb.team')}
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

  const bestMvpRow = db
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
    WHERE ${whccWhere} AND f.match_date_iso IS NOT NULL
    ORDER BY year DESC`
    )
    .all()
    .map((r) => r.year)

  const totalRuns = batRow?.total_runs || 0
  const totalOuts = batRow?.total_outs || 0
  const totalBatBalls = batRow?.total_balls || 0
  const totalWkts = bowlRow?.total_wickets || 0
  const totalBowlBalls = bowlRow?.total_balls || 0
  const totalBowlRuns = bowlRow?.total_runs || 0

  return {
    record: computeSeasonRecord(fixtures),
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
    match_scores: buildSeasonMatchScores(matchScoreFixtures),
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

  const { scorecards, hasDeliveries } = buildScorecards(db, fixtureId, fixture)

  const whccNames = db
    .prepare(`SELECT COALESCE(display_name, name) AS name FROM players WHERE ${whccCol('team')}`)
    .all()
    .map((r) => r.name)

  const fixtureMaxOvers = fixture.max_overs || DEFAULT_OVERS

  const { mvp, mvpMeta } = buildMvpForFixture(
    db,
    fixtureId,
    scorecards,
    hasDeliveries,
    fixtureMaxOvers
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
  return { fixture, scorecards, whccNames, mvp, mvpMeta, partnerships, phases, matchPlayers }
}

function getMatchRoles(db, fixtureId) {
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

  const fixtureTeams = db
    .prepare('SELECT home_team, away_team FROM fixtures WHERE fixture_id = ?')
    .get(fixtureId)
  const isWhccName = isWhccTeam
  const whccFixtureTeam = fixtureTeams
    ? ([fixtureTeams.home_team, fixtureTeams.away_team].find(isWhccName) ?? null)
    : null
  const oppFixtureTeam = fixtureTeams
    ? ([fixtureTeams.home_team, fixtureTeams.away_team].find((t) => !isWhccName(t)) ?? null)
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
      btRow?.team ?? (isManualFixture ? (order === 1 ? whccFixtureTeam : oppFixtureTeam) : null)

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
      const isWhccBatting = isWhccName(batting_team)
      const whccTeamFilter = whccCol('p.team')
      const teamFilter =
        batting_team === null
          ? ''
          : isWhccBatting
            ? `AND ${whccTeamFilter}`
            : `AND NOT ${whccTeamFilter}`
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
      batting_team: isWhccName(batting_team)
        ? (whccFixtureTeam ?? batting_team)
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
