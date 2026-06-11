import { describe, it, expect, beforeEach } from 'vitest'
import {
  isWhccTeam, netScore, ballsToOvers, formatDate, formatDateShort, parseMatchDate, computeResultPhrase,
  dn, setPlayerNames, displayName, shortTeam,
} from './cricket.js'

describe('shortTeam', () => {
  it('replaces long Woking & Horsell name', () => {
    expect(shortTeam('Woking & Horsell Cricket Club - Seniors')).toBe('WHCC Seniors')
  })
  it('replaces with CC variant', () => {
    expect(shortTeam('Woking and Horsell CC')).toBe('WHCC')
  })
  it('leaves unrelated names unchanged', () => {
    expect(shortTeam('Epsom CC')).toBe('Epsom CC')
  })
  it('handles null', () => expect(shortTeam(null)).toBe(null))
})

describe('dn (display name)', () => {
  beforeEach(() => setPlayerNames([]))

  it('returns first name when no duplicates', () => {
    expect(dn('Samuel Law')).toBe('Samuel')
  })
  it('adds last initial when first name is duplicated', () => {
    setPlayerNames(['Samuel Law', 'Samuel Adams'])
    expect(dn('Samuel Law')).toBe('Samuel L')
    expect(dn('Samuel Adams')).toBe('Samuel A')
  })
  it('keeps full name for single-initial first token', () => {
    expect(dn('S Law')).toBe('S Law')
  })
  it('returns single-initial name without last when no last name', () => {
    expect(dn('S')).toBe('S')
  })
  it('returns null/undefined as-is', () => {
    expect(dn(null)).toBe(null)
    expect(dn(undefined)).toBe(undefined)
  })
  it('no last initial when dupe but no last name', () => {
    setPlayerNames(['Sam', 'Sam Jones'])
    expect(dn('Sam')).toBe('Sam')
  })
})

describe('displayName (legacy)', () => {
  it('returns first name when no duplicates', () => {
    expect(displayName('Samuel Law', ['Samuel Law', 'John Smith'])).toBe('Samuel')
  })
  it('adds last initial when first name duplicated', () => {
    expect(displayName('Sam Law', ['Sam Law', 'Sam Adams'])).toBe('Sam L')
  })
  it('keeps full name for single-initial first token', () => {
    expect(displayName('S Law', [])).toBe('S Law')
  })
  it('handles null', () => expect(displayName(null, [])).toBe(null))
})

describe('isWhccTeam', () => {
  it('matches "Woking & Horsell CC" on the horsell marker', () => expect(isWhccTeam('Woking & Horsell CC - U11 Whirlwinds')).toBe(true))
  it('matches "WHCC Whirlwinds" on the whcc marker', () => expect(isWhccTeam('WHCC Whirlwinds')).toBe(true))
  it('matches "WHCC Hurricanes"', () => expect(isWhccTeam('WHCC Hurricanes')).toBe(true))
  it('rejects opposition', () => expect(isWhccTeam('Epsom CC')).toBe(false))
  // #122 regression: don't match look-alike clubs / shared sub-team names
  it('rejects "Old Woking CC" (bare woking)', () => expect(isWhccTeam('Old Woking CC - Under 11 A')).toBe(false))
  it('rejects "Camberley ... Lightning" (shared sub-team)', () => expect(isWhccTeam('Camberley CC - Girls Under 14 Lightning')).toBe(false))
  it('rejects "Horsley & Send ... Hurricanes" (shared sub-team)', () => expect(isWhccTeam('Horsley & Send CC - Under 10 Hurricanes')).toBe(false))
  it('handles null/empty', () => {
    expect(isWhccTeam(null)).toBe(false)
    expect(isWhccTeam('')).toBe(false)
  })
})

describe('netScore (pairs)', () => {
  it('applies wicket penalty', () => expect(netScore(120, 4, 0)).toBe(100))
  it('applies starting score', () => expect(netScore(120, 4, 10)).toBe(110))
  it('zero wickets', () => expect(netScore(80, 0, 0)).toBe(80))
  it('handles string inputs', () => expect(netScore('100', '2', 0)).toBe(90))
})

describe('ballsToOvers', () => {
  it('converts whole overs', () => expect(ballsToOvers(12)).toBe('2.0'))
  it('converts partial overs', () => expect(ballsToOvers(13)).toBe('2.1'))
  it('handles zero', () => expect(ballsToOvers(0)).toBe('0.0'))
  it('handles null', () => expect(ballsToOvers(null)).toBe('0.0'))
  it('5 balls is not a full over', () => expect(ballsToOvers(5)).toBe('0.5'))
})

describe('formatDate', () => {
  it('formats ISO date with day name', () => {
    expect(formatDate('2025-06-15')).toBe('Sunday 15 Jun 2025')
  })
  it('returns non-ISO strings unchanged', () => {
    expect(formatDate('Wednesday 2nd July 2025')).toBe('Wednesday 2nd July 2025')
  })
  it('handles null', () => expect(formatDate(null)).toBe(null))
})

describe('formatDateShort', () => {
  it('formats ISO date as D Mon YYYY', () => {
    expect(formatDateShort('2026-06-10')).toBe('10 Jun 2026')
  })
  it('strips leading zero from day', () => {
    expect(formatDateShort('2025-01-05')).toBe('5 Jan 2025')
  })
  it('handles December correctly', () => {
    expect(formatDateShort('2024-12-31')).toBe('31 Dec 2024')
  })
  it('returns non-ISO strings unchanged', () => {
    expect(formatDateShort('Wednesday 2nd July 2025')).toBe('Wednesday 2nd July 2025')
  })
  it('handles null', () => expect(formatDateShort(null)).toBe(null))
  it('handles undefined', () => expect(formatDateShort(undefined)).toBe(null))
})

describe('parseMatchDate', () => {
  it('parses ISO date', () => {
    expect(parseMatchDate('2025-06-15')).toBeGreaterThan(0)
  })
  it('newer date is larger', () => {
    expect(parseMatchDate('2025-06-15')).toBeGreaterThan(parseMatchDate('2024-06-15'))
  })
  it('handles null', () => expect(parseMatchDate(null)).toBe(0))
  it('parses non-ISO date string', () => {
    expect(parseMatchDate('Sunday 15 June 2025')).toBeGreaterThan(0)
  })
  it('returns 0 for unparseable string', () => {
    expect(parseMatchDate('not a date')).toBe(0)
  })
})

describe('computeResultPhrase', () => {
  const base = {
    home_team: 'WHCC Whirlwinds', away_team: 'Epsom CC',
    home_score: 150, home_wickets: 5, away_score: 120, away_wickets: 8,
    toss_winner: 'WHCC Whirlwinds', toss_decision: 'bat',
    format: 'standard', starting_score: 0,
  }

  it('WHCC bat first and win by runs', () => {
    expect(computeResultPhrase(base)).toBe('WHCC Whirlwinds won by 30 runs')
  })

  it('WHCC bat first and lose by wickets', () => {
    const m = { ...base, home_score: 100, away_score: 110, away_wickets: 3 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds lost by 7 wickets')
  })

  it('WHCC bowl first and win by wickets', () => {
    const m = { ...base, toss_decision: 'field', home_score: 150, home_wickets: 3, away_score: 140 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 7 wickets')
  })

  it('WHCC bowl first and lose by runs', () => {
    const m = { ...base, toss_decision: 'field', home_score: 100, away_score: 120 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds lost by 20 runs')
  })

  it('tied match', () => {
    const m = { ...base, home_score: 100, away_score: 100 }
    expect(computeResultPhrase(m)).toBe('Tied')
  })

  it('pairs format win', () => {
    // WHCC: 100 - (4*5) = 80 net; Opp: 80 - (6*5) = 50 net; win by 30
    const m = { ...base, format: 'pairs', home_score: 100, home_wickets: 4, away_score: 80, away_wickets: 6, starting_score: 0 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 30 runs (net)')
  })

  it('pairs format loss', () => {
    // WHCC: 80 - (6*5) = 50 net; Opp: 100 - (4*5) = 80 net; lose by 30
    const m = { ...base, format: 'pairs', home_score: 80, home_wickets: 6, away_score: 100, away_wickets: 4, starting_score: 0 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds lost by 30 runs (net)')
  })

  it('pairs format tie', () => {
    // WHCC: 90 - (2*5) = 80 net; Opp: 80 - (0*5) = 80 net; Tied
    const m = { ...base, format: 'pairs', home_score: 90, home_wickets: 2, away_score: 80, away_wickets: 0, starting_score: 0 }
    expect(computeResultPhrase(m)).toBe('Tied')
  })

  it('singular run/wicket wording', () => {
    const m = { ...base, home_score: 101, away_score: 100 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 1 run')
  })

  it('singular wicket wording', () => {
    const m = { ...base, toss_decision: 'field', home_score: 100, home_wickets: 9, away_score: 90 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 1 wicket')
  })

  it('returns result fallback when no scores', () => {
    const m = { ...base, home_score: null, result: 'Match abandoned' }
    expect(computeResultPhrase(m)).toBe('Match abandoned')
  })

  it('returns result fallback when no toss', () => {
    const m = { ...base, toss_winner: null, result: 'No result' }
    expect(computeResultPhrase(m)).toBe('No result')
  })

  it('win by wickets with balls remaining', () => {
    // WHCC bats second (field first), chases and wins before overs are up
    const m = { ...base, toss_decision: 'field', home_score: 150, home_wickets: 3,
      away_score: 140, away_overs: '20.0', home_overs: '18.2' }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 7 wickets with 10 balls remaining')
  })

  it('loss by wickets with balls remaining', () => {
    // WHCC bats first, opponent chases and wins before overs are up
    const m = { ...base, toss_decision: 'bat', home_score: 140, home_wickets: 8,
      away_score: 150, away_wickets: 3, home_overs: '20.0', away_overs: '18.2' }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds lost by 7 wickets with 10 balls remaining')
  })

  it('singular balls remaining', () => {
    const m = { ...base, toss_decision: 'field', home_score: 150, home_wickets: 9,
      away_score: 140, away_overs: '20.0', home_overs: '19.5' }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 1 wicket with 1 ball remaining')
  })

  it('10-player team: uses inn1_batters to compute wickets in hand', () => {
    // WHCC (home) fields first; opponent (away) bats first scoring 61; WHCC chases and wins 65/5
    // 10-player team: max 9 wickets; 9 - 5 = 4 wickets in hand, not 5
    const m = { ...base, toss_decision: 'field', away_score: 61, home_score: 65,
      home_wickets: 5, inn1_batters: 10 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 4 wickets')
  })

  it('inn1_batters undercounts when overs ended before all batted (#134 regression)', () => {
    // Fixture 25582288: Esher batted first (9 distinct batters faced, 7 dismissals — innings
    // ended by overs, 10th player never had to bat). WHCC chased 89/1.
    // Old formula: maxWickets = 9-1 = 8, n = 8-1 = 7 (wrong).
    // Fixed:       maxWickets = max(9,10)-1 = 9, n = 9-1 = 8.
    const m = { ...base, toss_decision: 'field',
      away_score: 87, away_wickets: 7,
      home_score: 89, home_wickets: 1,
      inn1_batters: 9 }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds won by 8 wickets')
  })

  it('first team all out early: balls remaining uses match allocation not actual overs', () => {
    // WHCC bats first, all out in 19 overs (114 balls), scores 100
    // Opponent chases 101 in 18.4 overs (112 balls) — 8 balls remaining from 20-over allocation, not 2
    const m = { ...base, toss_decision: 'bat', home_score: 100, home_wickets: 10,
      away_score: 101, away_wickets: 3, home_overs: '19.0', away_overs: '18.4' }
    expect(computeResultPhrase(m)).toBe('WHCC Whirlwinds lost by 7 wickets with 8 balls remaining')
  })
})
