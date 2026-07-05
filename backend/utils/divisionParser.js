'use strict'

// Re-exports the division standings/fixtures parsers, which live in their own files
// (divisionStandingsParser.js, divisionFixturesParser.js) — kept separate so a large
// multi-line regex construction in one doesn't get misattributed by complexity/LOC
// tooling to a function in the other.

const {
  extractDivisionId,
  parsePointsRules,
  parseStandingsRows
} = require('./divisionStandingsParser')
const { parseDivisionFixtures } = require('./divisionFixturesParser')

module.exports = {
  extractDivisionId,
  parsePointsRules,
  parseStandingsRows,
  parseDivisionFixtures
}
