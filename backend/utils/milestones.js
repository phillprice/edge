'use strict'

const { getClubFilters } = require('./db')

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

module.exports = { detectMilestones }
