'use strict'
const {
  isOurTeam,
  ourCol,
  ourFixtureWhere,
  ourPlayerWhere,
  ourTeamClause,
  DEFAULT_MARKERS
} = require('./db')

// Real team-name strings observed in the play-cricket data (#122).
const OURS = [
  'WHCC Hurricanes',
  'WHCC Whirlwinds',
  'Woking & Horsell CC - U11 Whirlwinds',
  'Woking & Horsell CC - U10 Hurricanes',
  'Woking & Horsell CC - Girls U13 Thunder',
  'Woking & Horsell CC - 4th XI',
  'Woking and Horsell CC'
]
const THEIRS = [
  'Old Woking CC - Under 11 A', // bare "woking" — different club
  'Camberley CC - Girls Under 14 Lightning', // shared sub-team name
  'Horsley & Send CC - Under 10 Hurricanes', // shared sub-team name + look-alike "Horsley"
  'Epsom CC - U11 T1',
  'Guildford CC - U10 Titans'
]

describe('isOurTeam', () => {
  it.each(OURS)('matches our team: %s', (name) => {
    expect(isOurTeam(name)).toBe(true)
  })
  it.each(THEIRS)('does NOT match opposition: %s', (name) => {
    expect(isOurTeam(name)).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(isOurTeam('WOKING & HORSELL CC')).toBe(true)
    expect(isOurTeam('whcc whirlwinds')).toBe(true)
  })
  it('handles null/empty/undefined safely', () => {
    expect(isOurTeam(null)).toBe(false)
    expect(isOurTeam(undefined)).toBe(false)
    expect(isOurTeam('')).toBe(false)
  })
  it('does not match bare "woking" (Old Woking CC regression)', () => {
    expect(isOurTeam('Old Woking CC')).toBe(false)
  })
})

describe('SQL fragments derive from the same markers', () => {
  it('ourCol references every marker against the given column', () => {
    const sql = ourCol('p.team')
    for (const m of DEFAULT_MARKERS) expect(sql).toContain(`lower(p.team) LIKE '%${m}%'`)
    expect(sql).not.toContain('woking') // bare woking dropped
    expect(sql).not.toContain('whirlwind')
  })
  it('ourFixtureWhere covers both home and away team columns', () => {
    const sql = ourFixtureWhere('f')
    expect(sql).toContain('f.home_team')
    expect(sql).toContain('f.away_team')
  })
  it('ourPlayerWhere targets the team column', () => {
    expect(ourPlayerWhere('p')).toContain('p.team')
  })
})

describe('ourTeamClause (sub-team narrowing)', () => {
  it('returns empty clause when no sub-team requested', () => {
    expect(ourTeamClause(null)).toEqual({ clause: '', params: [] })
  })
  it('requires a WHCC marker on the SAME side as the sub-team', () => {
    const { clause, params } = ourTeamClause('whirlwind')
    // sub-team uses parameterized ? placeholders; WHCC marker is still a hardcoded fragment
    expect(clause).toContain('lower(f.home_team) LIKE ?')
    expect(clause).toContain('lower(f.away_team) LIKE ?')
    expect(params).toEqual(['%whirlwind%', '%whirlwind%'])
    expect(clause).toContain("lower(f.home_team) LIKE '%horsell%'")
    expect(clause).toContain("lower(f.away_team) LIKE '%horsell%'")
  })
})
