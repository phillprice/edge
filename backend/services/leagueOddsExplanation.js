'use strict'

// Builds the human-readable reasoning trace behind a fixture's predicted odds — split out
// of leagueSimService.js into its own file so this logic's structure doesn't interact with
// the rest of that file's line/complexity metrics.

// Round a rate object's win rate to a whole percentage, or null if the rate is unavailable.
function winPct(rates) {
  return rates ? Math.round(rates.won * 100) : null
}

// Builds a plain-data explanation of how one fixture's odds were derived: each side's
// season win rate, recent-form win rate (if available), the head-to-head nudge outcome (if
// the teams met recently), and the final blended probabilities — surfaced to the frontend
// so users can see the reasoning behind the numbers, not just the numbers themselves.
function buildFixtureExplanation({
  homeTeamName,
  awayTeamName,
  homeSeasonRates,
  homeRecentRates,
  awaySeasonRates,
  awayRecentRates,
  h2hNudgeOutcome,
  probs
}) {
  return {
    homeTeam: homeTeamName,
    awayTeam: awayTeamName,
    homeSeasonWinPct: winPct(homeSeasonRates),
    homeRecentWinPct: winPct(homeRecentRates),
    awaySeasonWinPct: winPct(awaySeasonRates),
    awayRecentWinPct: winPct(awayRecentRates),
    h2hNudge: h2hNudgeOutcome,
    homeWinProbability: Math.round(probs.homeWin * 100),
    awayWinProbability: Math.round(probs.awayWin * 100),
    tieProbability: Math.round(probs.tie * 100)
  }
}

module.exports = { buildFixtureExplanation, _test: { winPct } }
