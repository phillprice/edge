'use strict'

const { getFixtureTags } = require('../utils/tags')
const resultsvault = require('../utils/resultsvault')

const DIVISION_CACHE_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours — standings/fixtures don't change faster
const OUTCOMES = ['homeWin', 'awayWin', 'tie', 'abandoned', 'cancelled']
const DEFAULT_OUTCOME_PROBS = {
  homeWin: 0.45,
  awayWin: 0.45,
  tie: 0.03,
  abandoned: 0.05,
  cancelled: 0.02
}

// Confirms the fixture is a league fixture and resolves its play-cricket division id.
// Returns null (not throws) for fixtures with no resolvable division — e.g. friendlies.
async function getDivisionIdForFixture(db, fixtureId, domain) {
  const tags = getFixtureTags(db, fixtureId)
  if (!tags.includes('league')) return null
  const row = db.prepare('SELECT play_cricket_id FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!row?.play_cricket_id) return null
  return resultsvault.fetchDivisionId(row.play_cricket_id, domain)
}

// Cache-backed fetch of a division's standings + upcoming fixtures. Simulation results
// are deliberately NOT cached (cheap to recompute, should reflect a fresh RNG draw), only
// the underlying I/O-bound standings/fixtures data is.
async function getOrRefreshDivisionData(db, divisionId, domain, { nextFixturesLimit = 10 } = {}) {
  const cached = db.prepare('SELECT * FROM division_cache WHERE division_id = ?').get(divisionId)
  if (cached && Date.now() - cached.computed_at < DIVISION_CACHE_TTL_MS) {
    return {
      standings: JSON.parse(cached.standings_json),
      fixtures: JSON.parse(cached.fixtures_json),
      pointsRules: JSON.parse(cached.points_rules_json)
    }
  }

  const [standingsResult, fixtures] = await Promise.all([
    resultsvault.fetchDivisionStandings(divisionId, domain),
    resultsvault.fetchDivisionFixtures(divisionId, { limit: nextFixturesLimit, domain })
  ])
  const { teams: standings, pointsRules } = standingsResult

  db.prepare(
    `INSERT OR REPLACE INTO division_cache
       (division_id, domain, standings_json, fixtures_json, points_rules_json, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    divisionId,
    domain,
    JSON.stringify(standings),
    JSON.stringify(fixtures),
    JSON.stringify(pointsRules),
    Date.now()
  )

  return { standings, fixtures, pointsRules }
}

// Normalizes a team name for matching fixture home/away strings against standings rows
// (both sources render the same "Club - Suffix" format, but tolerate whitespace/case drift).
function normalizeTeamName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Per-team rate of each outcome type, based on their current played record.
function teamOutcomeRates(team) {
  if (!team.played) return null
  return {
    won: team.won / team.played,
    lost: team.lost / team.played,
    tied: team.tied / team.played,
    abandoned: team.abandoned / team.played,
    cancelled: team.cancelled / team.played
  }
}

// Division-wide average rates, used as a fallback for teams with 0 played.
function divisionAverageRates(teams) {
  const withPlayed = teams.filter((t) => t.played)
  if (!withPlayed.length)
    return { won: 0.45, lost: 0.45, tied: 0.03, abandoned: 0.05, cancelled: 0.02 }
  const sum = { won: 0, lost: 0, tied: 0, abandoned: 0, cancelled: 0 }
  for (const t of withPlayed) {
    const r = teamOutcomeRates(t)
    for (const k of Object.keys(sum)) sum[k] += r[k]
  }
  for (const k of Object.keys(sum)) sum[k] /= withPlayed.length
  return sum
}

// Derives the 5-way outcome probability distribution for a fixture between two teams,
// blending each team's current per-outcome rate with the counterpart rate of its opponent.
// This is a simple current-form model, not a rating system — documented simplification.
function deriveOutcomeProbabilities(homeTeam, awayTeam, avgRates) {
  const home = teamOutcomeRates(homeTeam) || avgRates
  const away = teamOutcomeRates(awayTeam) || avgRates

  const raw = {
    homeWin: (home.won + away.lost) / 2,
    awayWin: (away.won + home.lost) / 2,
    tie: (home.tied + away.tied) / 2,
    abandoned: (home.abandoned + away.abandoned) / 2,
    cancelled: (home.cancelled + away.cancelled) / 2
  }
  const total = OUTCOMES.reduce((sum, k) => sum + raw[k], 0)
  if (!total) return { ...DEFAULT_OUTCOME_PROBS }
  const probs = {}
  for (const k of OUTCOMES) probs[k] = raw[k] / total
  return probs
}

function toCumulative(probs) {
  let acc = 0
  return OUTCOMES.map((k) => (acc += probs[k]))
}

function pickOutcome(cumulative, r) {
  for (let i = 0; i < cumulative.length; i++) if (r < cumulative[i]) return i
  return cumulative.length - 1
}

// Which pointsRules key each side (home, away) earns for a given outcome.
const OUTCOME_POINTS_KEYS = {
  homeWin: ['won', 'lost'],
  awayWin: ['lost', 'won'],
  tie: ['tied', 'tied'],
  abandoned: ['abandoned', 'abandoned'],
  cancelled: ['cancelled', 'cancelled']
}

// Applies the sampled outcome's points to both teams' running point totals.
function applyOutcome(pts, hIdx, aIdx, outcomeIdx, pointsRules) {
  const [homeKey, awayKey] = OUTCOME_POINTS_KEYS[OUTCOMES[outcomeIdx]]
  pts[hIdx] += pointsRules[homeKey] ?? 0
  pts[aIdx] += pointsRules[awayKey] ?? 0
}

// Ranks team indices by points desc, then the (division-wide, approximate — see plan notes
// on true pairwise H2H) H2H column desc, then team name asc.
function rankIndices(pts, teams) {
  return teams
    .map((_, i) => i)
    .sort((a, b) => {
      if (pts[b] !== pts[a]) return pts[b] - pts[a]
      const h2hDiff = (teams[b].h2h || 0) - (teams[a].h2h || 0)
      if (h2hDiff !== 0) return h2hDiff
      return teams[a].teamName.localeCompare(teams[b].teamName)
    })
}

function percentile(sortedSamples, p) {
  const idx = Math.min(sortedSamples.length - 1, Math.floor(p * sortedSamples.length))
  return sortedSamples[idx]
}

function summarizeHistogram(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]
  }
}

// Builds the simFixtures list — each remaining fixture resolved to standings-row indices
// plus its precomputed (static across all trials) outcome-probability cumulative array.
// Fixtures whose team names can't be matched to a standings row are skipped.
function buildSimFixtures(teams, fixtures) {
  const idxByName = new Map(teams.map((t, i) => [normalizeTeamName(t.teamName), i]))
  const avgRates = divisionAverageRates(teams)
  const simFixtures = []
  for (const f of fixtures) {
    const hIdx = idxByName.get(normalizeTeamName(f.homeTeam))
    const aIdx = idxByName.get(normalizeTeamName(f.awayTeam))
    if (hIdx == null || aIdx == null || hIdx === aIdx) continue
    const probs = deriveOutcomeProbabilities(teams[hIdx], teams[aIdx], avgRates)
    simFixtures.push({ hIdx, aIdx, cumulative: toCumulative(probs) })
  }
  return simFixtures
}

// Monte Carlo simulation of the division's remaining fixtures. Returns, per team, a
// probability distribution over finishing position plus a points-range histogram.
function simulateDivision(standings, fixtures, pointsRules, { trials = 10000 } = {}) {
  const teams = standings
  const simFixtures = buildSimFixtures(teams, fixtures)
  const n = teams.length
  const positionCounts = teams.map(() => new Array(n).fill(0))
  const pointsSamples = teams.map(() => [])
  const basePts = teams.map((t) => t.pts)

  for (let trial = 0; trial < trials; trial++) {
    const pts = basePts.slice()
    for (const sf of simFixtures) {
      const outcomeIdx = pickOutcome(sf.cumulative, Math.random())
      applyOutcome(pts, sf.hIdx, sf.aIdx, outcomeIdx, pointsRules)
    }
    const order = rankIndices(pts, teams)
    order.forEach((teamIdx, pos) => {
      positionCounts[teamIdx][pos]++
      pointsSamples[teamIdx].push(pts[teamIdx])
    })
  }

  const currentOrder = rankIndices(
    teams.map((t) => t.pts),
    teams
  )
  const currentPosByIdx = new Array(n)
  currentOrder.forEach((teamIdx, pos) => (currentPosByIdx[teamIdx] = pos + 1))

  return teams.map((t, i) => ({
    teamId: t.teamId,
    teamName: t.teamName,
    currentPos: currentPosByIdx[i],
    currentPts: t.pts,
    positionProbabilities: positionCounts[i].map((c) => c / trials),
    pointsHistogram: summarizeHistogram(pointsSamples[i])
  }))
}

const MAX_TRIALS = 20000
const DEFAULT_TRIALS = 10000

function clampTrials(trials) {
  const n = parseInt(trials, 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TRIALS
  return Math.min(n, MAX_TRIALS)
}

// Top-level orchestrator: resolves the division, refreshes/caches its data, runs the
// simulation, and returns the payload the API/frontend consumes. Returns null when the
// fixture isn't a league fixture with a resolvable division.
async function predictLeague(db, fixtureId, { trials, nextFixturesLimit = 10, domain } = {}) {
  const divisionId = await getDivisionIdForFixture(db, fixtureId, domain)
  if (!divisionId) return null

  const { standings, fixtures, pointsRules } = await getOrRefreshDivisionData(
    db,
    divisionId,
    domain,
    {
      nextFixturesLimit
    }
  )

  const clampedTrials = clampTrials(trials)
  const teams = simulateDivision(standings, fixtures, pointsRules, { trials: clampedTrials })

  return {
    divisionId,
    domain,
    pointsRules,
    tieBreakNote:
      'Ties are broken by points, then by the division table’s Head-to-Head column, then team name. ' +
      'This is an approximation of play-cricket’s real head-to-head/wickets tie-break rule, which is ' +
      'computed per specific pair of tied teams and not reproduced here.',
    trials: clampedTrials,
    teams,
    generatedAt: new Date().toISOString()
  }
}

module.exports = {
  getDivisionIdForFixture,
  getOrRefreshDivisionData,
  predictLeague,
  _test: {
    deriveOutcomeProbabilities,
    simulateDivision,
    rankIndices,
    summarizeHistogram,
    buildSimFixtures,
    normalizeTeamName
  }
}
