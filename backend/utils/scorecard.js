'use strict'

const { classifyDismissal } = require('./cricket')
const { buildMatchFlow, getFormatConfig } = require('./matchFlow')

const DEFAULT_OVERS = 20

function parseHowOut(s) {
  if (!s) return null
  const lo = s.trim().toLowerCase()
  if (lo.startsWith('run out')) {
    const m = s.match(/run out\s*\(([^)]+)\)/i)
    return { type: 'Run out', fielder: m?.[1]?.trim() || null, bowler: null }
  }
  if (lo.startsWith('c&b') || lo.startsWith('caught and bowled')) {
    const bowler = s.replace(/^(c&b|caught and bowled)\s*/i, '').trim() || null
    return { type: 'CaughtAndBowled', fielder: null, bowler }
  }
  if (lo.startsWith('lbw')) {
    const m = s.match(/lbw\s+b\s+(.+)/i)
    return { type: 'LBW', fielder: null, bowler: m?.[1]?.trim() || null }
  }
  const stM = s.match(/^(?:st|stumped)\s+(.+)\s+b\s+(\S.+)$/i)
  if (stM) return { type: 'Stumped', fielder: stM[1].trim(), bowler: stM[2].trim() }
  const ctM = s.match(/^(?:ct|caught)\s+(.+)\s+b\s+(\S.+)$/i)
  if (ctM) return { type: 'Caught', fielder: ctM[1].trim(), bowler: ctM[2].trim() }
  const bM = s.match(/^(?:b|bowled)\s+(\S.+)$/i)
  if (bM) return { type: 'Bowled', fielder: null, bowler: bM[1].trim() }
  return null
}

function getPartnerships(db, fixtureId) {
  const rows = db
    .prepare(
      `
    SELECT d.result_id, i.innings_order, d.over_no, d.ball_no,
           d.batter_id, d.batter_id_ns, d.runs_bat, d.runs_extra,
           d.extras_type, d.dismissed_batter_id
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
    ORDER BY i.innings_order, d.over_no, d.ball_no
  `
    )
    .all(fixtureId)

  if (!rows.length) return []

  const playerIds = new Set()
  for (const r of rows) {
    if (r.batter_id) playerIds.add(r.batter_id)
    if (r.batter_id_ns) playerIds.add(r.batter_id_ns)
  }
  const nameMap = {}
  if (playerIds.size) {
    const ph = [...playerIds].map(() => '?').join(',')
    for (const r of db
      .prepare(`SELECT player_id, name FROM players_dn WHERE player_id IN (${ph})`)
      .all(...playerIds)) {
      nameMap[r.player_id] = r.name
    }
  }

  const partnerships = []
  let current = null
  const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join(':')

  for (const d of rows) {
    const a = d.batter_id,
      b = d.batter_id_ns
    if (!a || !b || a === b) continue // skip if ns missing or same player as striker (bad data)
    const key = pairKey(a, b)

    if (!current || current.key !== key || current.innings_order !== d.innings_order) {
      current = {
        key,
        innings_order: d.innings_order,
        batter1_id: Math.min(a, b),
        batter2_id: Math.max(a, b),
        runs: 0,
        balls: 0,
        batter1_runs: 0,
        batter1_balls: 0,
        batter2_runs: 0,
        batter2_balls: 0,
        dismissed_batter_id: null
      }
      partnerships.push(current)
    }

    const isLegal = d.extras_type !== 1 && d.extras_type !== 2
    current.runs += d.runs_bat + (d.runs_extra || 0)
    if (isLegal) current.balls += 1

    if (d.batter_id === current.batter1_id) {
      current.batter1_runs += d.runs_bat
      if (isLegal) current.batter1_balls += 1
    } else {
      current.batter2_runs += d.runs_bat
      if (isLegal) current.batter2_balls += 1
    }

    if (d.dismissed_batter_id) current.dismissed_batter_id = d.dismissed_batter_id
  }

  return partnerships.map((p) => ({
    innings_order: p.innings_order,
    batter1_id: p.batter1_id,
    batter2_id: p.batter2_id,
    batter1_name: nameMap[p.batter1_id] || `#${p.batter1_id}`,
    batter2_name: nameMap[p.batter2_id] || `#${p.batter2_id}`,
    batter1_runs: p.batter1_runs,
    batter1_balls: p.batter1_balls,
    batter2_runs: p.batter2_runs,
    batter2_balls: p.batter2_balls,
    runs: p.runs,
    balls: p.balls,
    dismissed_batter_id: p.dismissed_batter_id
  }))
}

function ballsToOvers(balls) {
  if (!balls) return '0'
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

function getPhaseStats(db, fixtureId, maxOvers) {
  // Phase boundaries (1-based over numbers, inclusive) — format-aware
  const { phaseBoundaries: phases } = getFormatConfig(maxOvers)

  // over_no is 0-based in the DB; convert: over_no + 1 = over display number
  const rows = db
    .prepare(
      `
    SELECT
      i.innings_order,
      d.over_no,
      SUM(d.runs_bat) AS runs_bat,
      SUM(CASE WHEN d.extras_type IN (3,4) THEN d.runs_extra ELSE 0 END) AS byes_legbyes,
      SUM(CASE WHEN d.extras_type IN (1,2) THEN d.runs_extra ELSE 0 END) AS wides_noballs,
      COUNT(d.dismissed_batter_id) AS wickets,
      COUNT(CASE WHEN d.extras_type IS NULL OR d.extras_type NOT IN (1,2) THEN 1 END) AS legal_balls
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
    GROUP BY i.innings_order, d.over_no
    ORDER BY i.innings_order, d.over_no
  `
    )
    .all(fixtureId)

  if (!rows.length) return []

  // Group rows by innings_order
  const byInnings = {}
  for (const row of rows) {
    if (!byInnings[row.innings_order]) byInnings[row.innings_order] = []
    byInnings[row.innings_order].push(row)
  }

  const result = []
  for (const [inningsOrder, overs] of Object.entries(byInnings)) {
    const phaseStats = []
    for (const { phase, from, to } of phases) {
      // over_no is 0-based; display over = over_no + 1
      const phaseOvers = overs.filter((r) => {
        const dispOver = r.over_no + 1
        return dispOver >= from && dispOver <= to
      })
      if (!phaseOvers.length) continue

      const runs = phaseOvers.reduce((s, r) => s + r.runs_bat + r.byes_legbyes, 0)
      const wickets = phaseOvers.reduce((s, r) => s + r.wickets, 0)
      const balls = phaseOvers.reduce((s, r) => s + r.legal_balls, 0)
      const run_rate = balls > 0 ? ((runs / balls) * 6).toFixed(2) : '0.00'
      const actualFrom = Math.min(...phaseOvers.map((r) => r.over_no + 1))
      const actualTo = Math.max(...phaseOvers.map((r) => r.over_no + 1))
      phaseStats.push({ phase, from: actualFrom, to: actualTo, runs, wickets, balls, run_rate })
    }
    if (phaseStats.length) result.push({ innings_order: Number(inningsOrder), phases: phaseStats })
  }
  return result
}

function getSpells(db, fixtureId) {
  const overs = db
    .prepare(
      `
    SELECT i.innings_order, d.over_no, d.bowler_id,
      SUM(CASE WHEN d.extras_type IS NULL OR d.extras_type NOT IN (1,2) THEN 1 ELSE 0 END) AS legal_balls,
      SUM(CASE WHEN d.extras_type = 2 THEN 1 ELSE 0 END) AS wide_count,
      SUM(CASE WHEN d.extras_type = 1 THEN 1 ELSE 0 END) AS nb_count,
      SUM(d.runs_bat + CASE WHEN COALESCE(d.extras_type,0) NOT IN (3,4) THEN d.runs_extra ELSE 0 END) AS runs,
      SUM(CASE WHEN d.dismissed_batter_id IS NOT NULL
               AND COALESCE(dis.method,'') NOT IN ('RunOut','ObstructingField','HitBallTwice','TimedOut')
          THEN 1 ELSE 0 END) AS wickets,
      MAX(CASE WHEN d.extras_type IN (1,2) THEN 1 WHEN d.runs_bat > 0 THEN 1 ELSE 0 END) AS had_run
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    LEFT JOIN dismissals dis ON dis.fixture_id = i.fixture_id
                             AND dis.batter_id = d.dismissed_batter_id
                             AND dis.innings_order = i.innings_order
    WHERE i.fixture_id = ?
    GROUP BY i.innings_order, d.over_no, d.bowler_id
    ORDER BY i.innings_order, d.over_no
  `
    )
    .all(fixtureId)

  // active: map of `${innings_order}:${bowler_id}` → the spell currently being built for that bowler
  // spells: finished spells (bowler was rested for >2 overs before returning, or innings ended)
  const active = {}
  const spells = []
  for (const over of overs) {
    const key = `${over.innings_order}:${over.bowler_id}`
    const cur = active[key]
    if (cur && over.over_no - cur.to_over <= 2) {
      cur.to_over = over.over_no
      cur.balls += over.legal_balls
      cur.wides += over.wide_count
      cur.noBalls += over.nb_count
      cur.runs += over.runs
      cur.wickets += over.wickets
      if (over.had_run === 0) cur.maidens++
    } else {
      if (cur) spells.push(cur)
      active[key] = {
        innings_order: over.innings_order,
        bowler_id: over.bowler_id,
        from_over: over.over_no,
        to_over: over.over_no,
        balls: over.legal_balls,
        wides: over.wide_count,
        noBalls: over.nb_count,
        runs: over.runs,
        wickets: over.wickets,
        maidens: over.had_run === 0 ? 1 : 0
      }
    }
  }
  for (const spell of Object.values(active)) spells.push(spell)
  return spells
}

function buildManualScorecard(db, fixtureId, format, startingScore) {
  const isPairs = format === 'pairs'
  if (isPairs && !startingScore) startingScore = 200
  const extras = db
    .prepare(
      `SELECT batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs FROM manual_extras WHERE fixture_id = ?`
    )
    .get(fixtureId)
  const batting_extras = extras?.batting_extras ?? 0
  const bowling_byes = extras?.bowling_byes ?? 0
  const bowling_leg_byes = extras?.bowling_leg_byes ?? 0
  const whcc_overs_stored = extras?.whcc_overs ?? null
  const opp_overs_stored = extras?.opp_overs ?? null

  // ── WHCC batting innings ──────────────────────────────────────────────────
  const batRows = db
    .prepare(
      `
    SELECT mb.*, p.name FROM manual_batting mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.innings_order = 1 ORDER BY mb.id
  `
    )
    .all(fixtureId)

  const batting = batRows.map((b) => {
    const parsed = !b.not_out && !b.did_not_bat ? parseHowOut(b.how_out) : null
    const row = {
      player_id: b.player_id,
      name: b.name,
      runs: b.runs,
      balls: b.balls,
      fours: b.fours,
      sixes: b.sixes,
      dismissed: !b.not_out && !b.did_not_bat,
      dismissalDesc: b.did_not_bat
        ? 'did not bat'
        : b.not_out
          ? /^retired/i.test(b.how_out || '')
            ? 'retired not out'
            : 'not out'
          : b.how_out || 'out',
      dismissalType: parsed?.type || null,
      timesOut: !b.not_out && !b.did_not_bat ? 1 : 0,
      did_not_bat: !!b.did_not_bat
    }
    if (parsed) {
      row.dismissalFielder = parsed.fielder ?? null
      row.dismissalBowler = parsed.bowler ?? null
    }
    return row
  })

  const played = batRows.filter((b) => !b.did_not_bat)
  const batRuns = played.reduce((s, b) => s + b.runs, 0)
  const batBalls = played.reduce((s, b) => s + b.balls, 0)
  const batWkts = played.filter((b) => !b.not_out).length
  const whccTotal = batRuns + batting_extras
  const whcc_overs = whcc_overs_stored || (batBalls > 0 ? ballsToOvers(batBalls) : null)

  const whccSc = {
    inningsOrder: 1,
    isPairs,
    isManual: true,
    batting,
    bowling: [],
    overs: [],
    dismissalMethods: {},
    catches: {},
    totals: {
      runs: whccTotal,
      wickets: batWkts,
      overs: whcc_overs,
      extras: { total: batting_extras },
      netTotal: isPairs ? whccTotal + (startingScore || 0) - batWkts * 5 : null
    }
  }

  // ── Opposition batting (derived from WHCC bowling figures) ────────────────
  const bowlRows = db
    .prepare(
      `
    SELECT mbw.*, p.name FROM manual_bowling mbw
    JOIN players_dn p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ? AND mbw.innings_order = 2 ORDER BY mbw.id
  `
    )
    .all(fixtureId)

  const bowling = bowlRows.map((b) => ({
    player_id: b.player_id,
    name: b.name,
    balls: b.balls,
    overs: ballsToOvers(b.balls),
    runs: b.runs,
    wickets: b.wickets,
    wides: b.wides,
    noBalls: b.no_balls,
    maidens: b.maidens,
    economy: b.balls > 0 ? ((b.runs / b.balls) * 6).toFixed(2) : null
  }))

  const oppRuns = bowlRows.reduce((s, b) => s + b.runs, 0) + bowling_byes + bowling_leg_byes
  const oppWkts = bowlRows.reduce((s, b) => s + b.wickets, 0)
  const bowlBalls = bowlRows.reduce((s, b) => s + b.balls, 0)
  const opp_overs = opp_overs_stored || (bowlBalls > 0 ? ballsToOvers(bowlBalls) : null)

  const fieldRows = db
    .prepare(
      `
    SELECT mf.catches, mf.stumpings, mf.run_outs, p.name FROM manual_fielding mf
    JOIN players_dn p ON p.player_id = mf.player_id
    WHERE mf.fixture_id = ? AND mf.innings_order = 2 ORDER BY mf.id
  `
    )
    .all(fixtureId)

  const oppSc = {
    inningsOrder: 2,
    isPairs,
    isManual: true,
    batting: [],
    bowling,
    overs: [],
    fielding: fieldRows,
    dismissalMethods: {},
    catches: {},
    totals: {
      runs: oppRuns,
      wickets: oppWkts,
      overs: opp_overs,
      extras:
        bowling_byes || bowling_leg_byes
          ? { byes: bowling_byes, legByes: bowling_leg_byes, wides: 0, noBalls: 0 }
          : null,
      netTotal: isPairs ? oppRuns + (startingScore || 0) - oppWkts * 5 : null
    }
  }

  return [whccSc, oppSc]
}

// ── buildScorecard helpers ────────────────────────────────────────────────────

function accumulateBatters(deliveries, isPairs) {
  const batters = []
  const idx = {}
  for (const d of deliveries) {
    const id = d.batter_id
    if (idx[id] === undefined) {
      idx[id] = batters.length
      batters.push({
        player_id: id,
        name:
          d.batter_name || (id < 0 ? nameFromDesc(d.l_desc, 'batter') : null) || `#${Math.abs(id)}`,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        _dotBalls: 0,
        _facedBalls: 0,
        dismissed: false,
        dismissalDesc: null,
        dismissalType: null,
        timesOut: 0
      })
    }
    const b = batters[idx[id]]
    b.runs += d.runs_bat
    b.balls += 1
    if (d.runs_bat === 4) b.fours++
    if (d.runs_bat === 6) b.sixes++
    const isLegal = d.extras_type === null || (d.extras_type !== 1 && d.extras_type !== 2)
    if (isLegal) {
      b._facedBalls++
      if (d.runs_bat === 0 && (!d.runs_extra || d.runs_extra === 0)) b._dotBalls++
    }
    if (d.dismissed_batter_id === id) {
      if (isPairs) {
        b.timesOut++
      } else {
        b.dismissed = true
        b.dismissalDesc = d.l_desc?.trim() || 'out'
        b.dismissalType = classifyDismissal(d.l_desc, d.s_desc)
      }
    }
  }
  if (isPairs) {
    for (const b of batters) b.netScore = b.runs - b.timesOut * 5
  }
  for (const b of batters) {
    b.dot_pct = b._facedBalls > 0 ? Math.round(10 * (b._dotBalls / b._facedBalls) * 100) / 10 : null
    delete b._dotBalls
    delete b._facedBalls
  }
  return { batters, idx }
}

function enrichBattersFromDismissals(db, resultId, batters, idx) {
  const pdfDismissals = db
    .prepare(
      `
    SELECT dis.batter_id, dis.method, pf.name as fielder_name, dis.fielder_id, pb.name as bowler_name, dis.bowler_id
    FROM dismissals dis
    LEFT JOIN players_dn pf ON pf.player_id = dis.fielder_id
    LEFT JOIN players_dn pb ON pb.player_id = dis.bowler_id
    JOIN innings i ON i.fixture_id = dis.fixture_id AND i.innings_order = dis.innings_order
    WHERE i.result_id = ?
  `
    )
    .all(resultId)
  for (const pd of pdfDismissals) {
    if (!pd.batter_id || idx[pd.batter_id] === undefined) continue
    const b = batters[idx[pd.batter_id]]
    b.dismissed = pd.method !== 'Retired'
    b.dismissalType = pd.method
    b.dismissalDesc = formatDismissal(pd.method, pd.fielder_name, pd.bowler_name)
    b.dismissalFielder = pd.fielder_name ?? null
    b.dismissalFielderId = pd.fielder_id ?? null
    b.dismissalBowler = pd.bowler_name ?? null
    b.dismissalBowlerId = pd.bowler_id ?? null
  }
  // Apply display_name overrides to any remaining l_desc fallback strings
  const nameOverrides = db
    .prepare(`SELECT name, display_name FROM players WHERE display_name IS NOT NULL`)
    .all()
  if (nameOverrides.length) {
    for (const b of batters) {
      if (b.dismissalFielder === undefined && b.dismissalDesc && b.dismissalDesc !== 'out') {
        for (const { name, display_name } of nameOverrides) {
          b.dismissalDesc = b.dismissalDesc.replaceAll(name, display_name)
        }
      }
    }
  }
}

const BOWLER_CREDIT_METHODS = new Set([
  'Bowled', 'Caught', 'CaughtAndBowled', 'LBW', 'Stumped', 'HitWicket',
  'HandledBall', 'ObstructingField'
])

function isBowlerWicket(dismissedBatterId, dismissalMap, delivery = null) {
  if (!dismissedBatterId) return false
  const dis = dismissalMap?.[dismissedBatterId]?.[0]
  if (!dis) {
    // No dismissal record (batter name didn't resolve during ingest → batter_id = null in DB).
    // Fall back to delivery description to avoid crediting bowler for run-outs.
    if (delivery && classifyDismissal(delivery.l_desc, delivery.s_desc) === 'Run out') return false
    return true // no record — credit the bowler (legacy data)
  }
  return BOWLER_CREDIT_METHODS.has(dis.method)
}

function computeMaidens(deliveries, idx, bowlers) {
  const overGroups = {}
  for (const d of deliveries) {
    const key = `${d.over_no}:${d.bowler_id}`
    if (!overGroups[key]) overGroups[key] = { bowler_id: d.bowler_id, runs: 0 }
    overGroups[key].runs +=
      d.runs_bat + (d.extras_type === 3 || d.extras_type === 4 ? 0 : d.runs_extra)
  }
  for (const g of Object.values(overGroups)) {
    if (g.runs === 0 && idx[g.bowler_id] !== undefined) bowlers[idx[g.bowler_id]].maidens++
  }
}

function countLastOverBalls(deliveries, bowlerId, lastOver, inningsLastOver) {
  if (lastOver !== inningsLastOver) return 6
  return deliveries.filter(
    (d) =>
      d.bowler_id === bowlerId &&
      d.over_no === lastOver &&
      d.extras_type !== 1 &&
      d.extras_type !== 2
  ).length
}

function bowlerOversString(bOvers, lastBalls) {
  const complete = bOvers.length - (lastBalls < 6 ? 1 : 0)
  return lastBalls < 6 ? `${complete}.${lastBalls}` : String(complete)
}

function assignBowlerOvers(deliveries, overNos, bowlers, idx) {
  const inningsLastOver = overNos.length ? overNos[overNos.length - 1] : -1
  for (const b of bowlers) {
    const bOvers = [
      ...new Set(deliveries.filter((d) => d.bowler_id === b.player_id).map((d) => d.over_no))
    ].sort((a, x) => a - x)
    if (!bOvers.length) {
      b.overs = '0'
      b.economy = null
      continue
    }
    const bLast = bOvers[bOvers.length - 1]
    const lastBalls = countLastOverBalls(deliveries, b.player_id, bLast, inningsLastOver)
    const complete = bOvers.length - (lastBalls < 6 ? 1 : 0)
    b.overs = bowlerOversString(bOvers, lastBalls)
    const effOvers = complete + (lastBalls < 6 ? lastBalls / 6 : 0)
    b.economy = effOvers > 0 ? (b.runs / effOvers).toFixed(2) : null
    b.dot_pct = b._legalBalls > 0 ? Math.round(10 * (b._dotBalls / b._legalBalls) * 100) / 10 : null
    delete b._dotBalls
    delete b._legalBalls
  }
}

function accumulateDelivery(b, d, dismissalMap) {
  const isExtra = d.extras_type === 1 || d.extras_type === 2
  if (!isExtra) {
    b.balls++
    b._legalBalls++
    if (d.runs_bat === 0 && d.extras_type === null && (!d.runs_extra || d.runs_extra === 0))
      b._dotBalls++
  }
  b.runs += d.runs_bat + (d.extras_type === 3 || d.extras_type === 4 ? 0 : d.runs_extra)
  if (isBowlerWicket(d.dismissed_batter_id, dismissalMap, d)) b.wickets++
  if (d.extras_type === 2) b.wides += d.runs_extra
  if (d.extras_type === 1) b.noBalls += d.runs_extra
}

function accumulateBowlers(deliveries, overNos, dismissalMap = {}) {
  const bowlers = []
  const idx = {}
  for (const d of deliveries) {
    const id = d.bowler_id
    if (idx[id] === undefined) {
      idx[id] = bowlers.length
      bowlers.push({
        player_id: id,
        name:
          d.bowler_name || (id < 0 ? nameFromDesc(d.l_desc, 'bowler') : null) || `#${Math.abs(id)}`,
        balls: 0,
        runs: 0,
        wickets: 0,
        wides: 0,
        noBalls: 0,
        maidens: 0,
        _dotBalls: 0,
        _legalBalls: 0
      })
    }
    accumulateDelivery(bowlers[idx[id]], d, dismissalMap)
  }
  computeMaidens(deliveries, idx, bowlers)
  assignBowlerOvers(deliveries, overNos, bowlers, idx)
  return bowlers
}

function buildOverList(deliveries, overNos, dismissalMap, nullBatterByBowler) {
  return overNos.map((ov) => {
    const balls = deliveries
      .filter((d) => d.over_no === ov)
      .sort((a, b) => a.ball_no_disp - b.ball_no_disp)
    const runs = balls.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0)
    const wkts = balls.filter((d) => d.dismissed_batter_id).length
    return {
      over: ov + 1,
      runs,
      wickets: wkts,
      bowler:
        balls[0]?.bowler_name ||
        (balls[0]?.bowler_id < 0 ? nameFromDesc(balls[0]?.l_desc, 'bowler') : null) ||
        '?',
      bowler_id: balls[0]?.bowler_id ?? null,
      balls: balls.map((d) => {
        const dis = d.dismissed_batter_id
          ? (dismissalMap[d.dismissed_batter_id]?.[0] ??
            (d.bowler_id ? nullBatterByBowler[d.bowler_id] : null) ??
            null)
          : null
        return {
          id: d.id,
          s_desc: d.s_desc?.trim() || '.',
          runs_bat: d.runs_bat,
          runs_extra: d.runs_extra,
          extras_type: d.extras_type,
          wicket: !!d.dismissed_batter_id,
          batter_id: d.batter_id,
          batter_id_ns: d.batter_id_ns ?? null,
          batter_name: d.batter_name,
          bowler_id: d.bowler_id,
          bowler_name: d.bowler_name,
          dismissed_batter_id: d.dismissed_batter_id ?? null,
          dismissal_method: dis?.method ?? null,
          dismissal_fielder_id: dis?.fielder_id ?? null,
          dismissal_bowler_id: dis?.bowler_id ?? null
        }
      })
    }
  })
}

// ── buildScorecard ────────────────────────────────────────────────────────────

function buildScorecard(
  db,
  fixtureId,
  resultId,
  inningsOrder,
  format,
  startingScore,
  isWhccBatting = false,
  maxOvers = DEFAULT_OVERS
) {
  const isPairs = format === 'pairs'
  const deliveries = db
    .prepare(
      `
    SELECT d.*, p_bat.name as batter_name, p_bow.name as bowler_name
    FROM deliveries d
    LEFT JOIN players_dn p_bat ON p_bat.player_id = d.batter_id
    LEFT JOIN players_dn p_bow ON p_bow.player_id = d.bowler_id
    WHERE d.result_id = ?
    ORDER BY d.over_no, d.ball_no_disp
  `
    )
    .all(resultId)

  if (!deliveries.length)
    return { inningsOrder, isPairs, batting: [], bowling: [], overs: [], totals: {} }

  const wkAssignments = db
    .prepare(
      `
    SELECT wa.from_over, wa.to_over, p.name AS keeper_name
    FROM wk_assignments wa
    JOIN players_dn p ON p.player_id = wa.player_id
    WHERE wa.fixture_id = ? AND wa.innings_order = ?
    ORDER BY wa.from_over
  `
    )
    .all(fixtureId, inningsOrder)

  // Dismissal map for match flow (batter_id → [{method, fielder, ...}])
  const dismissalMap = {}
  for (const r of db
    .prepare(
      `
    SELECT dis.batter_id, dis.method, dis.fielder_id, dis.bowler_id, pf.name AS fielder_name
    FROM dismissals dis
    LEFT JOIN players_dn pf ON pf.player_id = dis.fielder_id
    WHERE dis.fixture_id = ? AND dis.innings_order = ?
  `
    )
    .all(fixtureId, inningsOrder)) {
    if (!dismissalMap[r.batter_id]) dismissalMap[r.batter_id] = []
    dismissalMap[r.batter_id].push({
      method: r.method,
      fielder: r.fielder_name,
      fielder_id: r.fielder_id,
      bowler_id: r.bowler_id
    })
  }
  const nullBatterByBowler = {}
  for (const di of dismissalMap[null] || []) {
    if (di.bowler_id && !nullBatterByBowler[di.bowler_id]) nullBatterByBowler[di.bowler_id] = di
  }

  const overNos = [...new Set(deliveries.map((d) => d.over_no))].sort((a, b) => a - b)

  const { batters, idx: batterIdx } = accumulateBatters(deliveries, isPairs)
  enrichBattersFromDismissals(db, resultId, batters, batterIdx)
  const bowlers = accumulateBowlers(deliveries, overNos, dismissalMap)
  const overs = buildOverList(deliveries, overNos, dismissalMap, nullBatterByBowler)

  const dismissalMethods = {}
  for (const b of batters) {
    if (!b.dismissed) continue
    const t = b.dismissalType || 'out'
    dismissalMethods[t] = (dismissalMethods[t] || 0) + 1
  }

  const catches = {}
  for (const d of deliveries) {
    if (!d.dismissed_batter_id) continue
    const catcher = parseCatcher(d.l_desc)
    if (catcher) catches[catcher] = (catches[catcher] || 0) + 1
  }

  const totalRuns = deliveries.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0)
  const totalWkts = deliveries.filter((d) => d.dismissed_batter_id).length
  const extras = { byes: 0, legByes: 0, wides: 0, noBalls: 0 }
  for (const d of deliveries) {
    if (d.extras_type === 3) extras.byes += d.runs_extra
    if (d.extras_type === 4) extras.legByes += d.runs_extra
    if (d.extras_type === 2) extras.wides += d.runs_extra
    if (d.extras_type === 1) extras.noBalls += d.runs_extra
  }

  const maxOverNo = overNos.length ? overNos[overNos.length - 1] : -1
  const ballsInLastOver =
    maxOverNo >= 0
      ? deliveries.filter(
          (d) => d.over_no === maxOverNo && d.extras_type !== 1 && d.extras_type !== 2
        ).length
      : 0
  const oversStr =
    maxOverNo < 0
      ? '0'
      : ballsInLastOver === 6
        ? String(maxOverNo + 1)
        : `${maxOverNo}.${ballsInLastOver}`

  return {
    inningsOrder,
    resultId,
    isPairs,
    batting: batters,
    bowling: bowlers,
    overs,
    dismissalMethods,
    catches,
    flow: buildMatchFlow(
      deliveries,
      isPairs,
      startingScore,
      dismissalMap,
      nullBatterByBowler,
      wkAssignments,
      isWhccBatting,
      maxOvers
    ),
    totals: {
      runs: totalRuns,
      wickets: totalWkts,
      overs: oversStr,
      extras,
      netTotal: isPairs ? totalRuns + (startingScore || 0) - totalWkts * 5 : null
    }
  }
}

// Returns format-specific thresholds keyed by max overs per innings.

function formatDismissal(method, fielder, bowler) {
  const f = fielder,
    b = bowler
  switch (method) {
    case 'Caught':
      return f && b ? `ct ${f} b ${b}` : b ? `caught b ${b}` : 'caught'
    case 'CaughtAndBowled':
      return b ? `c&b ${b}` : 'c&b'
    case 'Bowled':
      return b ? `b ${b}` : 'bowled'
    case 'LBW':
      return b ? `lbw b ${b}` : 'lbw'
    case 'Stumped':
      return f && b ? `st ${f} b ${b}` : 'stumped'
    case 'RunOut':
    case 'Run out':
      return f ? `run out (${f})` : 'run out'
    case 'Retired':
      return 'retired not out'
    default:
      return method || 'out'
  }
}

function parseCatcher(lDesc) {
  if (!lDesc) return null
  const lo = lDesc.toLowerCase()
  // Caught and bowled: bowler IS the catcher — check before generic 'ct' pattern
  if (lo.includes('c&b') || lo.includes('ct and b') || lo.includes('caught and bowled')) {
    const m = lDesc.match(/(?:c&b|ct and b|caught and bowled)\s+([A-Za-z][A-Za-z\s]+?)(?:\s*$)/i)
    return m ? m[1].trim() : null
  }
  // "ct Zayd Akhtar b Sebastian Mills" -> extract catcher name
  const m = lDesc.match(/\bct\s+([A-Za-z][A-Za-z\s]+?)\s+b\s/i)
  return m ? m[1].trim() : null
}

function nameFromDesc(desc, role) {
  // " Bowler to Batter: description" — extract bowler or batter name
  const m = /^\s*(.+?)\s+to\s+(.+?)\s*:/.exec(desc || '')
  if (!m) return null
  return role === 'bowler' ? m[1].trim() : m[2].trim()
}

module.exports = {
  getPartnerships,
  getPhaseStats,
  getSpells,
  buildManualScorecard,
  buildScorecard,
  formatDismissal,
  parseCatcher,
  nameFromDesc,
  parseHowOut
}
