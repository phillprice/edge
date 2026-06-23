'use strict'

const { ourCol } = require('./db')
const { getFormatConfig } = require('./matchFlow')

const DEFAULT_OVERS = 20

function buildManualMvp(db, fixtureId) {
  const bat = db
    .prepare(
      `
    SELECT mb.player_id, COALESCE(p.display_name, p.name) AS name,
      mb.runs * 0.1 AS bat_pts
    FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
  `
    )
    .all(fixtureId)

  const bowl = db
    .prepare(
      `
    SELECT mbw.player_id, COALESCE(p.display_name, p.name) AS name,
      mbw.wickets * 1.8
      + CASE WHEN mbw.wickets >= 5 THEN 1.0 WHEN mbw.wickets >= 3 THEN 0.5 ELSE 0.0 END AS bowl_pts
    FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ?
  `
    )
    .all(fixtureId)

  const scores = {}
  const entry = (pid, name) => {
    if (!scores[pid]) scores[pid] = { playerId: pid, name, bat: 0, bowl: 0, field: 0 }
    return scores[pid]
  }
  for (const r of bat) entry(r.player_id, r.name).bat += r.bat_pts
  for (const r of bowl) entry(r.player_id, r.name).bowl += r.bowl_pts

  return Object.values(scores)
    .map((s) => ({
      ...s,
      bat: +s.bat.toFixed(1),
      bowl: +s.bowl.toFixed(1),
      total: +(s.bat + s.bowl).toFixed(1)
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
}

function computeManualMvpForFixtures(db, fixtureIds) {
  const ph = fixtureIds.map(() => '?').join(',')

  const bat = db
    .prepare(
      `
    SELECT mb.fixture_id, mb.player_id, mb.runs * 0.1 AS pts
    FROM manual_batting mb WHERE mb.fixture_id IN (${ph}) AND mb.did_not_bat = 0
  `
    )
    .all(...fixtureIds)

  const bowl = db
    .prepare(
      `
    SELECT mbw.fixture_id, mbw.player_id,
      mbw.wickets * 1.8
      + CASE WHEN mbw.wickets >= 5 THEN 1.0 WHEN mbw.wickets >= 3 THEN 0.5 ELSE 0.0 END AS pts
    FROM manual_bowling mbw WHERE mbw.fixture_id IN (${ph})
  `
    )
    .all(...fixtureIds)

  const totals = {}
  for (const row of [...bat, ...bowl]) {
    if (!totals[row.fixture_id]) totals[row.fixture_id] = {}
    totals[row.fixture_id][row.player_id] = (totals[row.fixture_id][row.player_id] || 0) + row.pts
  }

  const allIds = [...new Set([...bat, ...bowl].map((r) => r.player_id))]
  const names = {}
  if (allIds.length) {
    const np = allIds.map(() => '?').join(',')
    for (const r of db
      .prepare(
        `SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${np})`
      )
      .all(...allIds))
      names[r.player_id] = r.name
  }

  const result = {}
  for (const [fid, players] of Object.entries(totals)) {
    const [topId, topPts] = Object.entries(players).sort((a, b) => b[1] - a[1])[0]
    result[fid] = { name: names[topId] || `#${topId}`, pts: +topPts.toFixed(1) }
  }
  return result
}

function buildMvp(db, fixtureId, scorecards, maxOvers = DEFAULT_OVERS, colWhere = ourCol) {
  const whccPlayers = db
    .prepare(
      `
    SELECT player_id, COALESCE(display_name, name) AS name FROM players
    WHERE ${colWhere('team')}
  `
    )
    .all()
  const whccIds = new Set(whccPlayers.map((p) => p.player_id))
  const nameMap = Object.fromEntries(whccPlayers.map((p) => [p.player_id, p.name]))

  const scores = {}
  const entry = (pid) => {
    if (!scores[pid])
      scores[pid] = {
        playerId: pid,
        name: nameMap[pid] || `#${pid}`,
        bat: 0,
        bowl: 0,
        field: 0,
        _batRuns: 0,
        _batBalls: 0,
        _batBase: 0,
        _batSRBonus: 0,
        _bowlBase: 0,
        _bowlHaulBonus: 0,
        _bowlMaidenBonus: 0
      }
    return scores[pid]
  }

  // Determine match type from fixture.max_overs (falls back to 20 for legacy matches)
  const fmtCfg = getFormatConfig(maxOvers)
  const { wicketVal, maidensPerWicket, srPct } = fmtCfg

  let whccTeamRuns = 0,
    whccTeamBalls = 0

  for (const sc of scorecards) {
    if (sc.isManual) continue

    const teamRuns = sc.batting.reduce((s, b) => s + b.runs, 0)
    const teamBalls = sc.batting.reduce((s, b) => s + (b.balls || 0), 0)
    const teamSR = teamBalls > 0 ? (teamRuns / teamBalls) * 100 : 0

    // Track WHCC batting innings for the meta team SR
    if (sc.batting.some((b) => whccIds.has(b.player_id))) {
      whccTeamRuns += teamRuns
      whccTeamBalls += teamBalls
    }

    for (const b of sc.batting) {
      if (!whccIds.has(b.player_id)) continue
      const basePts = b.runs * 0.1
      let srBonus = 0
      if (teamSR > 0 && b.balls > 0) {
        const playerSR = (b.runs / b.balls) * 100
        if (playerSR > teamSR) srBonus = basePts * (playerSR / teamSR - 1) * srPct
      }
      const e = entry(b.player_id)
      e.bat += basePts + srBonus
      e._batRuns += b.runs
      e._batBalls += b.balls || 0
      e._batBase += basePts
      e._batSRBonus += srBonus
    }

    for (const b of sc.bowling) {
      if (!whccIds.has(b.player_id)) continue
      const bowlBase = b.wickets * wicketVal
      const haulBonus = b.wickets >= 5 ? 1.0 : b.wickets >= 3 ? 0.5 : 0
      const maidenBonus = (b.maidens || 0) * (wicketVal / maidensPerWicket)
      const e = entry(b.player_id)
      e.bowl += bowlBase + haulBonus + maidenBonus
      e._bowlBase += bowlBase
      e._bowlHaulBonus += haulBonus
      e._bowlMaidenBonus += maidenBonus
    }
  }

  const fieldPts = wicketVal * 0.2
  const dis = db
    .prepare(`SELECT method, fielder_id FROM dismissals WHERE fixture_id = ?`)
    .all(fixtureId)
  for (const d of dis) {
    if (!d.fielder_id || !whccIds.has(d.fielder_id)) continue
    if (
      d.method === 'Caught' ||
      d.method === 'CaughtAndBowled' ||
      d.method === 'Stumped' ||
      d.method === 'RunOut'
    )
      entry(d.fielder_id).field += fieldPts
  }

  const players = Object.values(scores)
    .map((s) => ({
      playerId: s.playerId,
      name: s.name,
      bat: +s.bat.toFixed(1),
      bowl: +s.bowl.toFixed(1),
      field: +s.field.toFixed(1),
      total: +(s.bat + s.bowl + s.field).toFixed(1),
      batBase: +s._batBase.toFixed(2),
      batSR: s._batBalls > 0 ? Math.round((s._batRuns / s._batBalls) * 100) : null,
      batSRBonus: +s._batSRBonus.toFixed(2),
      bowlHaulBonus: +s._bowlHaulBonus.toFixed(2),
      bowlMaidenBonus: +s._bowlMaidenBonus.toFixed(2)
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)

  const meta = {
    matchType: fmtCfg.name,
    wicketVal,
    maidensPerWicket,
    srPct,
    teamSR: whccTeamBalls > 0 ? Math.round((whccTeamRuns / whccTeamBalls) * 100) : null
  }

  return { players, meta }
}

module.exports = {
  buildManualMvp,
  computeManualMvpForFixtures,
  buildMvp
}
