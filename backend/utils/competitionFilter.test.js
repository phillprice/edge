'use strict'

const { parseComp, compClause } = require('./competitionFilter')

describe('parseComp', () => {
  it('returns null for empty or missing input', () => {
    expect(parseComp(undefined)).toBeNull()
    expect(parseComp('')).toBeNull()
    expect(parseComp('invalid')).toBeNull()
  })

  it('accepts cup, friendly, league (case-insensitive)', () => {
    expect(parseComp('cup')).toBe('cup')
    expect(parseComp('CUP')).toBe('cup')
    expect(parseComp('Friendly')).toBe('friendly')
    expect(parseComp('LEAGUE')).toBe('league')
  })

  it('rejects unknown competition values', () => {
    expect(parseComp('t20')).toBeNull()
    expect(parseComp('pairs')).toBeNull()
  })
})

describe('compClause', () => {
  it('returns cup filter', () => {
    const { clause } = compClause('cup')
    expect(clause).toContain("LIKE '%cup%'")
  })

  it('returns friendly filter', () => {
    const { clause } = compClause('friendly')
    expect(clause).toContain("= 'friendly'")
  })

  it('returns league filter (excludes cup and friendly)', () => {
    const { clause } = compClause('league')
    expect(clause).toContain('NOT LIKE')
    expect(clause).toContain('friendly')
  })

  it('returns empty string for null', () => {
    const { clause } = compClause(null)
    expect(clause).toBe('')
  })
})
