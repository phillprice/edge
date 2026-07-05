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
// are deliberately NOT cached (cheap to recompute), only the underlying I/O-bound
// standings/fixtures data is.
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

// Which pointsRules key each side (home, away) earns for a given outcome.
const OUTCOME_POINTS_KEYS = {
  homeWin: ['won', 'lost'],
  awayWin: ['lost', 'won'],
  tie: ['tied', 'tied'],
  abandoned: ['abandoned', 'abandoned'],
  cancelled: ['cancelled', 'cancelled']
}

// Builds the simFixtures list — each remaining fixture resolved to standings-row indices
// plus its precomputed (fixed across the whole enumeration) outcome-probability distribution.
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
    simFixtures.push({ hIdx, aIdx, probs })
  }
  return simFixtures
}

// Assigns a stable index to every distinct team-pair that meets at least once among the
// simulated fixtures — used to track exact head-to-head points earned within the window.
function buildPairIndex(simFixtures) {
  const pairIndexOf = new Map()
  for (const sf of simFixtures) {
    const key = sf.hIdx < sf.aIdx ? `${sf.hIdx}-${sf.aIdx}` : `${sf.aIdx}-${sf.hIdx}`
    if (!pairIndexOf.has(key)) pairIndexOf.set(key, pairIndexOf.size)
  }
  return pairIndexOf
}

// Ranks team indices by points desc, then exact within-window head-to-head points (if the
// two teams met among the simulated fixtures), then the division table's aggregate H2H
// column (approximation for ties resolved by matches outside the simulated window), then name.
function rankIndices(pts, teams, windowH2h) {
  return teams
    .map((_, i) => i)
    .sort((a, b) => {
      if (pts[b] !== pts[a]) return pts[b] - pts[a]
      if (windowH2h) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        const pairIdx = windowH2h.pairIndexOf.get(key)
        if (pairIdx != null) {
          const aIsMin = a < b
          const aWindowPts = aIsMin ? windowH2h.h2hMin[pairIdx] : windowH2h.h2hMax[pairIdx]
          const bWindowPts = aIsMin ? windowH2h.h2hMax[pairIdx] : windowH2h.h2hMin[pairIdx]
          if (aWindowPts !== bWindowPts) return bWindowPts - aWindowPts
        }
      }
      const h2hDiff = (teams[b].h2h || 0) - (teams[a].h2h || 0)
      if (h2hDiff !== 0) return h2hDiff
      return teams[a].teamName.localeCompare(teams[b].teamName)
    })
}

function weightedPercentile(sortedWeighted, totalWeight, p) {
  const target = p * totalWeight
  let cum = 0
  for (const s of sortedWeighted) {
    cum += s.weight
    if (cum >= target) return s.value
  }
  return sortedWeighted[sortedWeighted.length - 1].value
}

// Like summarizeHistogram but over probability-weighted samples (exact enumeration produces
// a weight per distinct outcome, not one row per trial).
function weightedHistogram(samples) {
  const sorted = [...samples].sort((a, b) => a.value - b.value)
  const totalWeight = sorted.reduce((s, x) => s + x.weight, 0)
  return {
    min: sorted[0].value,
    p10: weightedPercentile(sorted, totalWeight, 0.1),
    median: weightedPercentile(sorted, totalWeight, 0.5),
    p90: weightedPercentile(sorted, totalWeight, 0.9),
    max: sorted[sorted.length - 1].value
  }
}

function stateKey(pts, h2hMin, h2hMax) {
  return pts.join(',') + '|' + h2hMin.join(',') + '|' + h2hMax.join(',')
}

// Applies one outcome to a state, returning a new state (the input is never mutated).
function applyOutcomeToState(state, sf, outcomeKey, pointsRules, pairIndexOf) {
  const [homeKey, awayKey] = OUTCOME_POINTS_KEYS[outcomeKey]
  const homePts = pointsRules[homeKey] ?? 0
  const awayPts = pointsRules[awayKey] ?? 0

  const pts = state.pts.slice()
  pts[sf.hIdx] += homePts
  pts[sf.aIdx] += awayPts

  const h2hMin = state.h2hMin.slice()
  const h2hMax = state.h2hMax.slice()
  const homeIsMin = sf.hIdx < sf.aIdx
  const pairKey = homeIsMin ? `${sf.hIdx}-${sf.aIdx}` : `${sf.aIdx}-${sf.hIdx}`
  const pairIdx = pairIndexOf.get(pairKey)
  if (homeIsMin) {
    h2hMin[pairIdx] += homePts
    h2hMax[pairIdx] += awayPts
  } else {
    h2hMin[pairIdx] += awayPts
    h2hMax[pairIdx] += homePts
  }

  return { pts, h2hMin, h2hMax }
}

// Safety valve for divisions with an unusually large number of live (non-zero-probability)
// outcomes: caps the number of distinct states tracked, keeping only the highest-probability
// ones. Zero-probability outcomes are pruned exactly (no approximation); this cap is the only
// place approximation could occur, and only kicks in far beyond any division we've seen.
const MAX_EXACT_STATES = 200000

// Exact enumeration over every remaining fixture, merging states that land on identical
// (points, within-window head-to-head) combinations so equivalent branches share one weight
// entry rather than being tracked separately.
function enumerateStates(teams, simFixtures, pointsRules, pairIndexOf) {
  const numPairs = pairIndexOf.size
  const initialPts = teams.map((t) => t.pts)
  const initialH2h = new Array(numPairs).fill(0)
  let states = new Map([
    [
      stateKey(initialPts, initialH2h, initialH2h),
      { pts: initialPts, h2hMin: initialH2h, h2hMax: initialH2h, prob: 1 }
    ]
  ])

  for (const sf of simFixtures) {
    const next = new Map()
    for (const state of states.values()) {
      for (const outcomeKey of OUTCOMES) {
        const p = sf.probs[outcomeKey]
        if (!p) continue // exact zero-probability pruning — not an approximation
        const applied = applyOutcomeToState(state, sf, outcomeKey, pointsRules, pairIndexOf)
        const prob = state.prob * p
        const key = stateKey(applied.pts, applied.h2hMin, applied.h2hMax)
        const existing = next.get(key)
        if (existing) existing.prob += prob
        else next.set(key, { ...applied, prob })
      }
    }
    states =
      next.size > MAX_EXACT_STATES
        ? new Map(
            [...next.entries()].sort((a, b) => b[1].prob - a[1].prob).slice(0, MAX_EXACT_STATES)
          )
        : next
  }
  return [...states.values()]
}

// Exact simulation of the division's remaining fixtures via weighted enumeration (no RNG —
// every reachable combination of outcomes is walked once, weighted by its exact probability).
// Returns, per team, a probability distribution over finishing position plus a points
// histogram, both computed exactly from the weighted state space (not sampled).
function simulateDivision(standings, fixtures, pointsRules) {
  const teams = standings
  const simFixtures = buildSimFixtures(teams, fixtures)
  const pairIndexOf = buildPairIndex(simFixtures)
  const n = teams.length
  const states = enumerateStates(teams, simFixtures, pointsRules, pairIndexOf)

  const positionWeights = teams.map(() => new Array(n).fill(0))
  const pointsWeighted = teams.map(() => [])

  for (const state of states) {
    const windowH2h = { pairIndexOf, h2hMin: state.h2hMin, h2hMax: state.h2hMax }
    const order = rankIndices(state.pts, teams, windowH2h)
    order.forEach((teamIdx, pos) => {
      positionWeights[teamIdx][pos] += state.prob
      pointsWeighted[teamIdx].push({ value: state.pts[teamIdx], weight: state.prob })
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
    positionProbabilities: positionWeights[i],
    pointsHistogram: weightedHistogram(pointsWeighted[i])
  }))
}

// Top-level orchestrator: resolves the division, refreshes/caches its data, runs the exact
// simulation, and returns the payload the API/frontend consumes. Returns null when the
// fixture isn't a league fixture with a resolvable division.
async function predictLeague(db, fixtureId, { nextFixturesLimit = 10, domain } = {}) {
  const divisionId = await getDivisionIdForFixture(db, fixtureId, domain)
  if (!divisionId) return null

  const { standings, fixtures, pointsRules } = await getOrRefreshDivisionData(
    db,
    divisionId,
    domain,
    { nextFixturesLimit }
  )

  const teams = simulateDivision(standings, fixtures, pointsRules)

  return {
    divisionId,
    domain,
    pointsRules,
    tieBreakNote:
      'Ties are broken by points, then by exact head-to-head results between the tied teams ' +
      'if they play each other again among the simulated fixtures, then by the division ' +
      'table’s aggregate Head-to-Head column for ties from earlier matches, then team name. ' +
      'Play-cricket’s wickets-based final tie-break isn’t modelled, since it depends on match ' +
      'scorelines this simulation doesn’t generate.',
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
    weightedHistogram,
    buildSimFixtures,
    buildPairIndex,
    normalizeTeamName
  }
}
