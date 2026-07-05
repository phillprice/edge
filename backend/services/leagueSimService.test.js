'use strict'

const {
  _test: {
    deriveOutcomeProbabilities,
    simulateDivision,
    rankIndices,
    summarizeHistogram,
    buildSimFixtures,
    normalizeTeamName
  }
} = require('./leagueSimService')

const POINTS_RULES = {
  won: 4,
  lost: 1,
  tied: 3,
  cancelled: 0,
  abandoned: 2,
  oppositionConceded: 4,
  teamConceded: 0
}

function makeTeam(overrides) {
  return {
    teamId: 1,
    teamName: 'Team A',
    played: 10,
    won: 5,
    lost: 5,
    tied: 0,
    cancelled: 0,
    abandoned: 0,
    oppConceded: 0,
    teamConceded: 0,
    pen: 0,
    h2h: 0,
    pts: 20,
    ...overrides
  }
}

describe('leagueSimService — normalizeTeamName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTeamName('  Woking & Horsell CC  -   U10  Whirlwinds ')).toBe(
      'woking & horsell cc - u10 whirlwinds'
    )
  })
  it('handles null/undefined', () => {
    expect(normalizeTeamName(null)).toBe('')
    expect(normalizeTeamName(undefined)).toBe('')
  })
})

describe('leagueSimService — deriveOutcomeProbabilities', () => {
  it('produces a distribution that sums to 1', () => {
    const home = makeTeam({ won: 8, lost: 2, played: 10 })
    const away = makeTeam({ won: 2, lost: 8, played: 10 })
    const avg = { won: 0.45, lost: 0.45, tied: 0.03, abandoned: 0.05, cancelled: 0.02 }
    const probs = deriveOutcomeProbabilities(home, away, avg)
    const total = Object.values(probs).reduce((s, v) => s + v, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('favours a strong home team over a weak away team', () => {
    const home = makeTeam({ won: 9, lost: 1, played: 10 })
    const away = makeTeam({ won: 1, lost: 9, played: 10 })
    const avg = { won: 0.45, lost: 0.45, tied: 0.03, abandoned: 0.05, cancelled: 0.02 }
    const probs = deriveOutcomeProbabilities(home, away, avg)
    expect(probs.homeWin).toBeGreaterThan(probs.awayWin)
  })

  it('falls back to division-average rates for a team with 0 played', () => {
    const home = makeTeam({ played: 0, won: 0, lost: 0 })
    const away = makeTeam({ won: 5, lost: 5, played: 10 })
    const avg = { won: 0.5, lost: 0.5, tied: 0, abandoned: 0, cancelled: 0 }
    const probs = deriveOutcomeProbabilities(home, away, avg)
    expect(probs.homeWin).toBeCloseTo((0.5 + 0.5) / 2 / 1, 5)
  })
})

describe('leagueSimService — rankIndices', () => {
  const teams = [
    makeTeam({ teamId: 1, teamName: 'Alpha', h2h: 0 }),
    makeTeam({ teamId: 2, teamName: 'Beta', h2h: 5 }),
    makeTeam({ teamId: 3, teamName: 'Zulu', h2h: 0 })
  ]

  it('ranks by points descending', () => {
    const order = rankIndices([10, 30, 20], teams)
    expect(order).toEqual([1, 2, 0])
  })

  it('breaks a points tie using the H2H column', () => {
    const order = rankIndices([10, 10, 5], teams)
    expect(order[0]).toBe(1) // Beta has h2h=5, wins tie over Alpha's h2h=0
    expect(order[1]).toBe(0)
  })

  it('breaks a full tie alphabetically by team name', () => {
    const order = rankIndices(
      [10, 10, 10],
      [
        makeTeam({ teamId: 1, teamName: 'Zulu', h2h: 0 }),
        makeTeam({ teamId: 2, teamName: 'Alpha', h2h: 0 })
      ]
    )
    expect(order).toEqual([1, 0])
  })
})

describe('leagueSimService — summarizeHistogram', () => {
  it('computes min/median/max over a sample set', () => {
    const h = summarizeHistogram([10, 20, 30, 40, 50])
    expect(h.min).toBe(10)
    expect(h.max).toBe(50)
    expect(h.median).toBe(30)
  })
})

describe('leagueSimService — buildSimFixtures', () => {
  const teams = [
    makeTeam({ teamId: 1, teamName: 'Woking & Horsell CC - U10 Whirlwinds' }),
    makeTeam({ teamId: 2, teamName: 'Pirbright CC - Pumas' })
  ]

  it('resolves fixture team names to standings indices', () => {
    const fixtures = [
      { homeTeam: 'Woking & Horsell CC - U10 Whirlwinds', awayTeam: 'Pirbright CC - Pumas' }
    ]
    const simFixtures = buildSimFixtures(teams, fixtures)
    expect(simFixtures).toHaveLength(1)
    expect(simFixtures[0].hIdx).toBe(0)
    expect(simFixtures[0].aIdx).toBe(1)
    expect(simFixtures[0].cumulative).toHaveLength(5)
  })

  it('skips a fixture whose team name cannot be matched to a standings row', () => {
    const fixtures = [{ homeTeam: 'Unknown CC - Under 10', awayTeam: 'Pirbright CC - Pumas' }]
    expect(buildSimFixtures(teams, fixtures)).toHaveLength(0)
  })

  it('is case/whitespace-insensitive when matching team names', () => {
    const fixtures = [
      { homeTeam: '  woking & horsell cc - u10 whirlwinds', awayTeam: 'PIRBRIGHT CC - PUMAS  ' }
    ]
    expect(buildSimFixtures(teams, fixtures)).toHaveLength(1)
  })
})

describe('leagueSimService — simulateDivision (statistical sanity)', () => {
  it('a dominant team currently well ahead should finish 1st in the large majority of trials', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'Strong CC', won: 10, lost: 0, played: 10, pts: 40 }),
      makeTeam({ teamId: 2, teamName: 'Weak CC', won: 0, lost: 10, played: 10, pts: 4 })
    ]
    // Only one remaining fixture between them — the current 36-point gap should dominate.
    const fixtures = [{ homeTeam: 'Strong CC', awayTeam: 'Weak CC' }]
    const result = simulateDivision(teams, fixtures, POINTS_RULES, { trials: 2000 })
    const strong = result.find((t) => t.teamName === 'Strong CC')
    expect(strong.positionProbabilities[0]).toBeGreaterThan(0.9)
    expect(strong.currentPos).toBe(1)
  })

  it('position probabilities sum to 1 for every team', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', pts: 20 }),
      makeTeam({ teamId: 2, teamName: 'B', pts: 18 }),
      makeTeam({ teamId: 3, teamName: 'C', pts: 15 })
    ]
    const fixtures = [
      { homeTeam: 'A', awayTeam: 'B' },
      { homeTeam: 'B', awayTeam: 'C' }
    ]
    const result = simulateDivision(teams, fixtures, POINTS_RULES, { trials: 500 })
    for (const team of result) {
      const total = team.positionProbabilities.reduce((s, v) => s + v, 0)
      expect(total).toBeCloseTo(1, 5)
    }
  })

  it('returns currentPts unchanged from the input standings', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', pts: 20 }),
      makeTeam({ teamId: 2, teamName: 'B', pts: 18 })
    ]
    const result = simulateDivision(teams, [], POINTS_RULES, { trials: 100 })
    expect(result.find((t) => t.teamName === 'A').currentPts).toBe(20)
  })
})
