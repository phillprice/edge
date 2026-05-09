import { describe, it, expect } from 'vitest'
import {
  isWhccTeam, netScore, ballsToOvers, formatDate, parseMatchDate, computeResultPhrase
} from './cricket.js'

describe('isWhccTeam', () => {
  it('matches woking', () => expect(isWhccTeam('Woking & Horsell CC')).toBe(true))
  it('matches whirlwind', () => expect(isWhccTeam('WHCC Whirlwinds')).toBe(true))
  it('matches hurricane', () => expect(isWhccTeam('WHCC Hurricanes')).toBe(true))
  it('rejects opposition', () => expect(isWhccTeam('Epsom CC')).toBe(false))
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

describe('parseMatchDate', () => {
  it('parses ISO date', () => {
    expect(parseMatchDate('2025-06-15')).toBeGreaterThan(0)
  })
  it('newer date is larger', () => {
    expect(parseMatchDate('2025-06-15')).toBeGreaterThan(parseMatchDate('2024-06-15'))
  })
  it('handles null', () => expect(parseMatchDate(null)).toBe(0))
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
})
