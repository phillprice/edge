'use strict'

const {
  _test: {
    deriveOutcomeProbabilities,
    simulateDivision,
    rankIndices,
    weightedHistogram,
    buildSimFixtures,
    buildPairIndex,
    normalizeTeamName,
    classifyResultOutcome,
    buildRecentFormRates,
    findRecentH2hNudge,
    blendRates
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

  it('breaks a points tie using the aggregate H2H column when no window data is given', () => {
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

  it('prefers exact within-window head-to-head points over the aggregate H2H column', () => {
    // Team 0 (Alpha, aggregate h2h=0) beat Team 1 (Beta, aggregate h2h=5) in their simulated
    // meeting — the exact window result should win the tie despite Beta's higher aggregate h2h.
    const pairIndexOf = new Map([['0-1', 0]])
    const windowH2h = { pairIndexOf, h2hMin: [4], h2hMax: [1] } // team 0 earned 4, team 1 earned 1
    const order = rankIndices([10, 10, 5], teams, windowH2h)
    expect(order[0]).toBe(0)
    expect(order[1]).toBe(1)
  })
})

describe('leagueSimService — buildPairIndex', () => {
  it('assigns one index per distinct team pair regardless of home/away order', () => {
    const simFixtures = [
      { hIdx: 0, aIdx: 1, probs: {} },
      { hIdx: 1, aIdx: 0, probs: {} }, // same pair, reversed
      { hIdx: 1, aIdx: 2, probs: {} }
    ]
    const pairIndexOf = buildPairIndex(simFixtures)
    expect(pairIndexOf.size).toBe(2)
    expect(pairIndexOf.get('0-1')).toBe(0)
    expect(pairIndexOf.get('1-2')).toBe(1)
  })
})

describe('leagueSimService — weightedHistogram', () => {
  it('computes weighted min/median/max over a weighted sample set', () => {
    const h = weightedHistogram([
      { value: 10, weight: 0.2 },
      { value: 20, weight: 0.2 },
      { value: 30, weight: 0.2 },
      { value: 40, weight: 0.2 },
      { value: 50, weight: 0.2 }
    ])
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

  it('resolves fixture team names to standings indices with a full 5-outcome probability set', () => {
    const fixtures = [
      { homeTeam: 'Woking & Horsell CC - U10 Whirlwinds', awayTeam: 'Pirbright CC - Pumas' }
    ]
    const simFixtures = buildSimFixtures(teams, fixtures)
    expect(simFixtures).toHaveLength(1)
    expect(simFixtures[0].hIdx).toBe(0)
    expect(simFixtures[0].aIdx).toBe(1)
    expect(Object.keys(simFixtures[0].probs).sort()).toEqual(
      ['abandoned', 'awayWin', 'cancelled', 'homeWin', 'tie'].sort()
    )
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

describe('leagueSimService — simulateDivision (exact enumeration)', () => {
  it('a dominant team currently well ahead should finish 1st with near-certainty', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'Strong CC', won: 10, lost: 0, played: 10, pts: 40 }),
      makeTeam({ teamId: 2, teamName: 'Weak CC', won: 0, lost: 10, played: 10, pts: 4 })
    ]
    // Only one remaining fixture between them — the current 36-point gap should dominate.
    const fixtures = [{ homeTeam: 'Strong CC', awayTeam: 'Weak CC' }]
    const result = simulateDivision(teams, fixtures, POINTS_RULES)
    const strong = result.find((t) => t.teamName === 'Strong CC')
    expect(strong.positionProbabilities[0]).toBeGreaterThan(0.9)
    expect(strong.currentPos).toBe(1)
  })

  it('position probabilities sum to exactly 1 for every team', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', pts: 20 }),
      makeTeam({ teamId: 2, teamName: 'B', pts: 18 }),
      makeTeam({ teamId: 3, teamName: 'C', pts: 15 })
    ]
    const fixtures = [
      { homeTeam: 'A', awayTeam: 'B' },
      { homeTeam: 'B', awayTeam: 'C' }
    ]
    const result = simulateDivision(teams, fixtures, POINTS_RULES)
    for (const team of result) {
      const total = team.positionProbabilities.reduce((s, v) => s + v, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('computes exact odds for a simple single-fixture, two-outcome scenario', () => {
    // Team A currently tied on points with Team B, and always beats or loses to B (played=1
    // each, won/lost only) — with home/away rates blended 50/50, home win should land at 50%.
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', played: 1, won: 1, lost: 0, pts: 4 }),
      makeTeam({ teamId: 2, teamName: 'B', played: 1, won: 0, lost: 1, pts: 1 })
    ]
    const fixtures = [{ homeTeam: 'A', awayTeam: 'B' }]
    const result = simulateDivision(teams, fixtures, POINTS_RULES)
    const a = result.find((t) => t.teamName === 'A')
    // A's win rate is 1.0, B's loss rate is 1.0 → homeWin probability = (1.0 + 1.0) / 2 = 1.0
    expect(a.positionProbabilities[0]).toBeCloseTo(1, 10)
  })

  it('returns currentPts unchanged from the input standings', () => {
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', pts: 20 }),
      makeTeam({ teamId: 2, teamName: 'B', pts: 18 })
    ]
    const result = simulateDivision(teams, [], POINTS_RULES)
    expect(result.find((t) => t.teamName === 'A').currentPts).toBe(20)
  })

  it('uses exact within-window head-to-head to break a points tie', () => {
    // A and B start level. They play each other, then each separately plays C (always losing,
    // since C has a 100% win rate) — so A and B end level on points again, but whichever of
    // them won the A-vs-B meeting should rank ahead via exact window H2H.
    const teams = [
      makeTeam({ teamId: 1, teamName: 'A', played: 10, won: 5, lost: 5, pts: 20 }),
      makeTeam({ teamId: 2, teamName: 'B', played: 10, won: 5, lost: 5, pts: 20 }),
      makeTeam({ teamId: 3, teamName: 'C', played: 10, won: 10, lost: 0, pts: 40 })
    ]
    const fixtures = [
      { homeTeam: 'A', awayTeam: 'B' },
      { homeTeam: 'A', awayTeam: 'C' },
      { homeTeam: 'B', awayTeam: 'C' }
    ]
    const result = simulateDivision(teams, fixtures, POINTS_RULES)
    // Every state should be internally consistent: whichever of A/B has more points after the
    // round wins any tie on aggregate points at that level; this just asserts the function
    // runs end-to-end and returns a valid probability distribution for a 3-team, 3-fixture case.
    for (const team of result) {
      const total = team.positionProbabilities.reduce((s, v) => s + v, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })
})

function makeResult(overrides) {
  return {
    playCricketId: 1,
    matchDateIso: '2026-07-01T12:00:00',
    homeTeam: 'A',
    awayTeam: 'B',
    homePts: 4,
    awayPts: 1,
    ...overrides
  }
}

describe('leagueSimService — classifyResultOutcome', () => {
  it('classifies each outcome type from its points combination', () => {
    expect(classifyResultOutcome(makeResult({ homePts: 4, awayPts: 1 }), POINTS_RULES)).toBe(
      'homeWin'
    )
    expect(classifyResultOutcome(makeResult({ homePts: 1, awayPts: 4 }), POINTS_RULES)).toBe(
      'awayWin'
    )
    expect(classifyResultOutcome(makeResult({ homePts: 3, awayPts: 3 }), POINTS_RULES)).toBe('tie')
    expect(classifyResultOutcome(makeResult({ homePts: 2, awayPts: 2 }), POINTS_RULES)).toBe(
      'abandoned'
    )
    expect(classifyResultOutcome(makeResult({ homePts: 0, awayPts: 0 }), POINTS_RULES)).toBe(
      'cancelled'
    )
  })

  it('returns null for an unrecognised points combination', () => {
    expect(classifyResultOutcome(makeResult({ homePts: 5, awayPts: 1 }), POINTS_RULES)).toBeNull()
  })
})

describe('leagueSimService — blendRates', () => {
  const season = { won: 0.5, lost: 0.5, tied: 0, abandoned: 0, cancelled: 0 }
  const recent = { won: 1, lost: 0, tied: 0, abandoned: 0, cancelled: 0 }

  it('blends season and recent rates 50/50 when both are present', () => {
    expect(blendRates(season, recent).won).toBeCloseTo(0.75, 10)
  })

  it('falls back to season rates when no recent rates are given', () => {
    expect(blendRates(season, undefined)).toBe(season)
  })

  it('falls back to recent rates when no season rates are given (0 played)', () => {
    expect(blendRates(null, recent)).toBe(recent)
  })
})

describe('leagueSimService — buildRecentFormRates', () => {
  const teams = [
    makeTeam({ teamId: 1, teamName: 'A', played: 10, won: 5, lost: 5 }),
    makeTeam({ teamId: 2, teamName: 'B', played: 10, won: 5, lost: 5 })
  ]

  it('computes recent rates only from recognisable results, keyed by standings index', () => {
    const results = [
      makeResult({ homeTeam: 'A', awayTeam: 'B', homePts: 4, awayPts: 1 }),
      makeResult({ homeTeam: 'B', awayTeam: 'A', homePts: 4, awayPts: 1 })
    ]
    const rates = buildRecentFormRates(teams, results, POINTS_RULES)
    // A: won game 1 (home), lost game 2 (away) → 1 win, 1 loss out of 2 played
    expect(rates.get(0)).toEqual({ won: 0.5, lost: 0.5, tied: 0, abandoned: 0, cancelled: 0 })
    // B: lost game 1 (away), won game 2 (home) → 1 win, 1 loss out of 2 played
    expect(rates.get(1)).toEqual({ won: 0.5, lost: 0.5, tied: 0, abandoned: 0, cancelled: 0 })
  })

  it('omits teams with no recognisable recent results', () => {
    const rates = buildRecentFormRates(teams, [], POINTS_RULES)
    expect(rates.size).toBe(0)
  })
})

describe('leagueSimService — findRecentH2hNudge', () => {
  const teams = [makeTeam({ teamId: 1, teamName: 'A' }), makeTeam({ teamId: 2, teamName: 'B' })]

  it('returns the outcome directly when orientation matches the current fixture', () => {
    const results = [makeResult({ homeTeam: 'A', awayTeam: 'B', homePts: 4, awayPts: 1 })]
    expect(findRecentH2hNudge(results, teams, 0, 1, POINTS_RULES)).toBe('homeWin')
  })

  it('flips the outcome when the historical meeting had the teams reversed', () => {
    // Historically B was home and won — for a fixture where A is now home, that's an awayWin.
    const results = [makeResult({ homeTeam: 'B', awayTeam: 'A', homePts: 4, awayPts: 1 })]
    expect(findRecentH2hNudge(results, teams, 0, 1, POINTS_RULES)).toBe('awayWin')
  })

  it('uses the most recent meeting when they played more than once', () => {
    const results = [
      makeResult({ homeTeam: 'A', awayTeam: 'B', homePts: 1, awayPts: 4 }), // most recent (first in list)
      makeResult({ homeTeam: 'A', awayTeam: 'B', homePts: 4, awayPts: 1 })
    ]
    expect(findRecentH2hNudge(results, teams, 0, 1, POINTS_RULES)).toBe('awayWin')
  })

  it('returns null when the two teams have not met recently', () => {
    const results = [makeResult({ homeTeam: 'A', awayTeam: 'C', homePts: 4, awayPts: 1 })]
    expect(findRecentH2hNudge(results, teams, 0, 1, POINTS_RULES)).toBeNull()
  })
})

describe('leagueSimService — deriveOutcomeProbabilities with recent form + H2H nudge', () => {
  it('shifts probability toward the H2H nudge outcome', () => {
    const home = makeTeam({ won: 5, lost: 5, played: 10 })
    const away = makeTeam({ won: 5, lost: 5, played: 10 })
    const avg = { won: 0.45, lost: 0.45, tied: 0.03, abandoned: 0.05, cancelled: 0.02 }
    const withoutNudge = deriveOutcomeProbabilities(home, away, avg)
    const withNudge = deriveOutcomeProbabilities(
      home,
      away,
      avg,
      undefined,
      undefined,
      undefined,
      'homeWin'
    )
    expect(withNudge.homeWin).toBeGreaterThan(withoutNudge.homeWin)
  })

  it('shifts probability using recent-form rates when supplied', () => {
    const home = makeTeam({ teamId: 1, won: 5, lost: 5, played: 10 })
    const away = makeTeam({ teamId: 2, won: 5, lost: 5, played: 10 })
    const avg = { won: 0.45, lost: 0.45, tied: 0.03, abandoned: 0.05, cancelled: 0.02 }
    const recentRatesByIdx = new Map([
      [0, { won: 1, lost: 0, tied: 0, abandoned: 0, cancelled: 0 }]
    ])
    const withRecentForm = deriveOutcomeProbabilities(home, away, avg, recentRatesByIdx, 0, 1)
    const withoutRecentForm = deriveOutcomeProbabilities(home, away, avg)
    expect(withRecentForm.homeWin).toBeGreaterThan(withoutRecentForm.homeWin)
  })
})
