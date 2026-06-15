'use strict'

const {
  _normaliseName: normaliseName,
  _fuzzyNameMatch: fuzzyNameMatch,
  _bowlerIdFromMap: bowlerIdFromMap
} = require('./index')

describe('normaliseName', () => {
  it('lowercases and trims', () => {
    expect(normaliseName('  Leo Price  ')).toBe('leo price')
  })

  it('collapses multiple spaces', () => {
    expect(normaliseName('L  Price')).toBe('l price')
  })

  it('strips dot from single-letter initial', () => {
    expect(normaliseName('L. Price')).toBe('l price')
    expect(normaliseName('D. Cottrell')).toBe('d cottrell')
  })

  it('does not strip dots from longer words', () => {
    expect(normaliseName('St. John')).toBe('st. john')
  })
})

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

  it('matches through dot normalisation — "L. Price" ↔ "Leo Price"', () => {
    expect(fuzzyNameMatch('L. Price', 'Leo Price')).toBe(true)
    expect(fuzzyNameMatch('Leo Price', 'L. Price')).toBe(true)
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

  it('matches when over header uses full forename, map has initial', () => {
    const m = { 'd cottrell': 42 }
    expect(bowlerIdFromMap(m, 'Dylan Cottrell')).toBe(42)
  })

  it('matches when over header uses initial, map has full forename', () => {
    const m = { 'dylan cottrell': 42 }
    expect(bowlerIdFromMap(m, 'D Cottrell')).toBe(42)
  })

  it('handles dotted initial in over header — "L. Price" maps to "leo price" key', () => {
    expect(bowlerIdFromMap(map, 'L. Price')).toBe(7)
  })

  it('returns null for unrecognised name', () => {
    expect(bowlerIdFromMap(map, 'Unknown Bowler')).toBeNull()
  })

  it('returns null for empty name', () => {
    expect(bowlerIdFromMap(map, '')).toBeNull()
  })
})
