'use strict'

const { parseTypes, typesClause, VALID_TYPE_TAGS } = require('./competitionFilter')

describe('parseTypes', () => {
  it('returns null for empty or missing input', () => {
    expect(parseTypes(undefined)).toBeNull()
    expect(parseTypes('')).toBeNull()
  })

  it('returns null when nothing valid remains after filtering', () => {
    expect(parseTypes('invalid,also-invalid')).toBeNull()
  })

  it('parses a single valid tag (case-insensitive)', () => {
    expect(parseTypes('CUP')).toEqual(['cup'])
    expect(parseTypes('League')).toEqual(['league'])
  })

  it('parses multiple comma-separated tags, dropping invalid ones', () => {
    expect(parseTypes('league,cup,bogus')).toEqual(['league', 'cup'])
  })

  it('accepts every documented valid tag', () => {
    expect(parseTypes(VALID_TYPE_TAGS.join(','))).toEqual(VALID_TYPE_TAGS)
  })
})

describe('typesClause', () => {
  it('returns empty clause and params for null/empty input', () => {
    expect(typesClause(null)).toEqual({ clause: '', params: [] })
    expect(typesClause([])).toEqual({ clause: '', params: [] })
  })

  it('builds a fixture_tags EXISTS clause with one placeholder per type', () => {
    const { clause, params } = typesClause(['cup'])
    expect(clause).toContain('fixture_tags')
    expect(clause).toContain('IN (?)')
    expect(params).toEqual(['cup'])
  })

  it('builds a fixture_tags EXISTS clause with multiple placeholders', () => {
    const { clause, params } = typesClause(['league', 'cup'])
    expect(clause).toContain('IN (?, ?)')
    expect(params).toEqual(['league', 'cup'])
  })
})
