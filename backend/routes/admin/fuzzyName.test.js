'use strict'

const { _fuzzyNameMatch: fuzzyNameMatch, _bowlerIdFromMap: bowlerIdFromMap } = require('./index')

describe('fuzzyNameMatch', () => {
  it('matches identical names', () => {
    expect(fuzzyNameMatch('Leo Price', 'Leo Price')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(fuzzyNameMatch('LEO PRICE', 'leo price')).toBe(true)
  })

  it('matches initial to full forename (initial first)', () => {
    expect(fuzzyNameMatch('L Price', 'Leo Price')).toBe(true)
  })

  it('matches full forename to initial (full first)', () => {
    expect(fuzzyNameMatch('Leo Price', 'L Price')).toBe(true)
  })

  it('matches D Cottrell ↔ Dylan Cottrell', () => {
    expect(fuzzyNameMatch('D Cottrell', 'Dylan Cottrell')).toBe(true)
    expect(fuzzyNameMatch('Dylan Cottrell', 'D Cottrell')).toBe(true)
  })

  it('does not match different initials', () => {
    expect(fuzzyNameMatch('D Price', 'E Price')).toBe(false)
  })

  it('does not match different surnames', () => {
    expect(fuzzyNameMatch('L Price', 'Leo Jones')).toBe(false)
  })

  it('does not false-positive on shared first char with different forenames', () => {
    expect(fuzzyNameMatch('Dan Price', 'David Price')).toBe(false)
  })

  it('returns false when either argument is falsy', () => {
    expect(fuzzyNameMatch(null, 'Leo Price')).toBe(false)
    expect(fuzzyNameMatch('Leo Price', '')).toBe(false)
    expect(fuzzyNameMatch(null, null)).toBe(false)
  })

  it('returns false for two different single-word names', () => {
    expect(fuzzyNameMatch('Price', 'Jones')).toBe(false)
  })
})

describe('bowlerIdFromMap', () => {
  const map = { 'd cottrell': 42, 'leo price': 7 }

  it('returns id for exact match', () => {
    expect(bowlerIdFromMap(map, 'Leo Price')).toBe(7)
  })

  it('returns id when over header uses full forename, map has initial', () => {
    expect(bowlerIdFromMap(map, 'Dylan Cottrell')).toBe(42)
  })

  it('returns id when over header uses initial, map has full forename', () => {
    const fullMap = { 'dylan cottrell': 42 }
    expect(bowlerIdFromMap(fullMap, 'D Cottrell')).toBe(42)
  })

  it('returns null for unrecognised name', () => {
    expect(bowlerIdFromMap(map, 'Unknown Bowler')).toBeNull()
  })

  it('returns null for empty name', () => {
    expect(bowlerIdFromMap(map, '')).toBeNull()
  })
})
