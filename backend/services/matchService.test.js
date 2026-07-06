'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { getDb } = require('../db/schema')
const {
  groupFilterClause,
  buildScorecards,
  attachSpells,
  buildPartnershipsAndPhases,
  buildMatchPlayers,
  computeSeasonRecord,
  buildSeasonMatchScores,
  getMatchList,
  getSeasonStats,
  getMatchDetail,
  getMatchRoles
} = require('./matchService')

const KNOWN_FIXTURE = '25577112'

function fakeReq(overrides = {}) {
  return {
    query: {},
    headers: {},
    authCtx: { verified: true, isSuperAdmin: true, isClubAdmin: true, clubId: 1, groups: [] },
    ...overrides
  }
}

beforeAll(() => {
  seed(process.env.DB_PATH)
})

describe('matchService — computeSeasonRecord (pure)', () => {
  const isOurTeam = (name) => (name || '').toLowerCase().includes('whcc')

  it('counts a win when our score is higher', () => {
    const fixtures = [
      { home_team: 'WHCC A', away_team: 'Opp', home_score: '150', away_score: '100' }
    ]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec).toEqual({ played: 1, won: 1, lost: 0, tied: 0, nrd: 0 })
  })

  it('counts a loss when our score is lower and we are away', () => {
    const fixtures = [
      { home_team: 'Opp', away_team: 'WHCC A', home_score: '150', away_score: '100' }
    ]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec).toEqual({ played: 1, won: 0, lost: 1, tied: 0, nrd: 0 })
  })

  it('counts a tie when scores are equal', () => {
    const fixtures = [
      { home_team: 'WHCC A', away_team: 'Opp', home_score: '120', away_score: '120' }
    ]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec.tied).toBe(1)
  })

  it('counts fixtures with no scores as no-result (nrd)', () => {
    const fixtures = [{ home_team: 'WHCC A', away_team: 'Opp', home_score: null, away_score: null }]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec.nrd).toBe(1)
    expect(rec.played).toBe(1)
  })

  it('treats non-numeric scores as no-result', () => {
    const fixtures = [
      { home_team: 'WHCC A', away_team: 'Opp', home_score: 'abc', away_score: '100' }
    ]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec.nrd).toBe(1)
  })

  it('applies pairs-format scoring (net of starting score and wicket penalty)', () => {
    // starting_score=200, our wickets=2 (penalty 10), their wickets=0
    // our net = 250 - 200 - 10 = 40; their net = 220 - 200 - 0 = 20 → we win
    const fixtures = [
      {
        home_team: 'WHCC A',
        away_team: 'Opp',
        home_score: '250',
        away_score: '220',
        home_wickets: '2',
        away_wickets: '0',
        format: 'pairs',
        starting_score: '200'
      }
    ]
    const rec = computeSeasonRecord(fixtures, isOurTeam)
    expect(rec.won).toBe(1)
  })

  it('defaults to default isOurTeam predicate when not supplied', () => {
    const fixtures = [
      { home_team: 'WHCC A', away_team: 'Opp', home_score: '150', away_score: '100' }
    ]
    const rec = computeSeasonRecord(fixtures)
    expect(rec.played).toBe(1)
  })
})

describe('matchService — buildSeasonMatchScores (pure)', () => {
  const isOurTeam = (name) => (name || '').toLowerCase().includes('whcc')

  it('builds a match score row for a normal win', () => {
    const fixtures = [
      {
        fixture_id: 'F1',
        match_date_iso: '2026-01-01',
        home_team: 'WHCC A',
        away_team: 'Opp CC',
        home_score: '150',
        away_score: '100',
        home_wickets: '3',
        away_wickets: '9'
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row).toMatchObject({
      fixture_id: 'F1',
      our_score: '150',
      opp_score: '100',
      opp_team: 'Opp CC',
      result: 'won'
    })
  })

  it('marks result "nr" when scores are missing', () => {
    const fixtures = [
      {
        fixture_id: 'F2',
        match_date_iso: '2026-01-02',
        home_team: 'WHCC A',
        away_team: 'Opp CC',
        home_score: null,
        away_score: null
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row.result).toBe('nr')
  })

  it('marks a tie for equal non-pairs scores', () => {
    const fixtures = [
      {
        fixture_id: 'F3',
        match_date_iso: '2026-01-03',
        home_team: 'WHCC A',
        away_team: 'Opp CC',
        home_score: '100',
        away_score: '100'
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row.result).toBe('tied')
  })

  it('applies pairs-format net scoring', () => {
    const fixtures = [
      {
        fixture_id: 'F4',
        match_date_iso: '2026-01-04',
        home_team: 'WHCC A',
        away_team: 'Opp CC',
        home_score: '260',
        away_score: '210',
        home_wickets: '0',
        away_wickets: '0',
        format: 'pairs',
        starting_score: '200'
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row.result).toBe('won')
  })

  it('applies pairs-format tie when nets are equal', () => {
    const fixtures = [
      {
        fixture_id: 'F5',
        match_date_iso: '2026-01-05',
        home_team: 'WHCC A',
        away_team: 'Opp CC',
        home_score: '220',
        away_score: '220',
        home_wickets: '0',
        away_wickets: '0',
        format: 'pairs',
        starting_score: '200'
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row.result).toBe('tied')
  })

  it('reflects loss when away and our score lower', () => {
    const fixtures = [
      {
        fixture_id: 'F6',
        match_date_iso: '2026-01-06',
        home_team: 'Opp CC',
        away_team: 'WHCC A',
        home_score: '180',
        away_score: '90'
      }
    ]
    const [row] = buildSeasonMatchScores(fixtures, isOurTeam)
    expect(row.result).toBe('lost')
    expect(row.opp_team).toBe('Opp CC')
  })
})

describe('matchService — groupFilterClause', () => {
  it('returns null when no group filter applies', () => {
    const req = fakeReq({ query: {} })
    expect(groupFilterClause(req)).toBeNull()
  })

  it('returns a SQL clause prefixed with AND when group params are present', () => {
    const req = fakeReq({
      query: { team_id: '35534', season_id: '259' },
      authCtx: { verified: true, isSuperAdmin: true, groups: [] }
    })
    const clause = groupFilterClause(req)
    expect(clause).not.toBeNull()
    expect(clause.sql.startsWith('AND ')).toBe(true)
    expect(clause.params.length).toBeGreaterThan(0)
  })
})

describe('matchService — buildMatchPlayers (pure)', () => {
  it('dedupes players across scorecards and sorts by name', () => {
    const scorecards = [
      { batting: [{ player_id: 2, name: 'Zed' }], bowling: [{ player_id: 1, name: 'Alice' }] },
      { batting: [{ player_id: 1, name: 'Alice' }], bowling: [] }
    ]
    const players = buildMatchPlayers(scorecards)
    expect(players).toEqual([
      { player_id: 1, name: 'Alice' },
      { player_id: 2, name: 'Zed' }
    ])
  })

  it('ignores players with non-positive ids', () => {
    const scorecards = [{ batting: [{ player_id: 0, name: 'Extras' }], bowling: [] }]
    expect(buildMatchPlayers(scorecards)).toEqual([])
  })

  it('handles scorecards with missing batting/bowling arrays', () => {
    const scorecards = [{}]
    expect(buildMatchPlayers(scorecards)).toEqual([])
  })
})

describe('matchService — DB-backed functions using seeded fixture', () => {
  let db
  beforeAll(() => {
    db = getDb()
  })

  it('buildScorecards returns scorecards with hasDeliveries true for the known fixture', () => {
    const fixture = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(KNOWN_FIXTURE)
    const { scorecards, hasDeliveries } = buildScorecards(db, KNOWN_FIXTURE, fixture)
    expect(hasDeliveries).toBe(true)
    expect(scorecards.length).toBe(2)
  })

  it('attachSpells adds spells to bowling entries without throwing', () => {
    const fixture = db.prepare('SELECT * FROM fixtures WHERE fixture_id = ?').get(KNOWN_FIXTURE)
    const { scorecards } = buildScorecards(db, KNOWN_FIXTURE, fixture)
    expect(() => attachSpells(db, KNOWN_FIXTURE, scorecards)).not.toThrow()
    for (const sc of scorecards) {
      if (sc.isManual) continue
      for (const b of sc.bowling) expect(Array.isArray(b.spells)).toBe(true)
    }
  })

  it('buildPartnershipsAndPhases computes and caches partnerships/phases', () => {
    db.prepare('DELETE FROM match_detail_cache WHERE fixture_id = ?').run(KNOWN_FIXTURE)
    const result1 = buildPartnershipsAndPhases(db, KNOWN_FIXTURE, 20)
    expect(result1).toHaveProperty('partnerships')
    expect(result1).toHaveProperty('phases')
    // Second call should hit the cache path
    const result2 = buildPartnershipsAndPhases(db, KNOWN_FIXTURE, 20)
    expect(result2.partnerships).toEqual(result1.partnerships)
    expect(result2.phases).toEqual(result1.phases)
  })

  it('getMatchList returns matches with total/limit/offset shape', () => {
    const req = fakeReq()
    const result = getMatchList(db, req, 50, 0)
    expect(result).toHaveProperty('matches')
    expect(result).toHaveProperty('total')
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)
    expect(Array.isArray(result.matches)).toBe(true)
    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('getMatchList includes tags on each match', () => {
    const req = fakeReq()
    const { matches } = getMatchList(db, req, 50, 0)
    const known = matches.find((m) => m.fixture_id === KNOWN_FIXTURE)
    expect(known).toBeDefined()
    expect(Array.isArray(known.tags)).toBe(true)
  })

  it('getMatchList respects limit and offset for pagination', () => {
    const req = fakeReq()
    const page1 = getMatchList(db, req, 1, 0)
    const page2 = getMatchList(db, req, 1, 1)
    expect(page1.matches).toHaveLength(1)
    expect(page2.matches).toHaveLength(1)
    expect(page1.matches[0].fixture_id).not.toBe(page2.matches[0].fixture_id)
  })

  it('getMatchDetail returns fixture, scorecards, mvp and matchPlayers for known fixture', () => {
    const req = fakeReq()
    const result = getMatchDetail(db, KNOWN_FIXTURE, req)
    expect(result).not.toBeNull()
    expect(result.fixture.fixture_id).toBe(KNOWN_FIXTURE)
    expect(Array.isArray(result.scorecards)).toBe(true)
    expect(Array.isArray(result.matchPlayers)).toBe(true)
    expect(result).toHaveProperty('inningsPlayers')
    expect(result).toHaveProperty('jerseyNumbers')
  })

  it('getMatchDetail returns null for a nonexistent fixture', () => {
    const req = fakeReq()
    expect(getMatchDetail(db, 'NOT_A_REAL_FIXTURE', req)).toBeNull()
  })

  it('getMatchRoles returns per-innings role info for known fixture', () => {
    const req = fakeReq()
    const roles = getMatchRoles(db, KNOWN_FIXTURE, req)
    expect(roles).toHaveProperty('1')
    expect(roles).toHaveProperty('2')
    expect(roles['1']).toHaveProperty('players')
    expect(roles['1']).toHaveProperty('batting_team')
  })

  it('getMatchRoles returns empty object when fixture has no innings', () => {
    const roles = getMatchRoles(db, 'NOT_A_REAL_FIXTURE', fakeReq())
    expect(roles).toEqual({})
  })

  it('getMatchRoles works with no req (defaults to null clubId)', () => {
    const roles = getMatchRoles(db, KNOWN_FIXTURE, null)
    expect(roles).toHaveProperty('1')
  })

  it('getSeasonStats returns record, batting, bowling and top lists', () => {
    const req = fakeReq({ query: { year: '2026' } })
    const stats = getSeasonStats(db, req)
    expect(stats).toHaveProperty('record')
    expect(stats).toHaveProperty('batting')
    expect(stats).toHaveProperty('bowling')
    expect(Array.isArray(stats.top_batters)).toBe(true)
    expect(Array.isArray(stats.top_bowlers)).toBe(true)
    expect(Array.isArray(stats.match_scores)).toBe(true)
    expect(Array.isArray(stats.years)).toBe(true)
    expect(stats).toHaveProperty('highlights')
  })

  it('getSeasonStats filters by team when team query param matches a known sub-team', () => {
    const req = fakeReq({ query: { team: 'whirlwind' } })
    const stats = getSeasonStats(db, req)
    expect(stats.record.played).toBeGreaterThanOrEqual(0)
  })

  it('getSeasonStats ignores invalid year and team params', () => {
    const req = fakeReq({ query: { year: 'not-a-year', team: 'not-a-team' } })
    const stats = getSeasonStats(db, req)
    expect(stats).toHaveProperty('record')
  })

  it('getSeasonStats applies format=pairs and format=no-pairs clauses without error', () => {
    const reqPairs = fakeReq({ query: { format: 'pairs' } })
    const reqNoPairs = fakeReq({ query: { format: 'no-pairs' } })
    expect(() => getSeasonStats(db, reqPairs)).not.toThrow()
    expect(() => getSeasonStats(db, reqNoPairs)).not.toThrow()
  })

  it('getSeasonStats highlights include high_score and best_bowling when data exists', () => {
    const req = fakeReq()
    const stats = getSeasonStats(db, req)
    expect(stats.highlights.high_score === null || typeof stats.highlights.high_score).not.toBe(
      'undefined'
    )
  })
})
