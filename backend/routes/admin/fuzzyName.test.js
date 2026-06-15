'use strict'

const Database = require('better-sqlite3')
const {
  _normaliseName: normaliseName,
  _fuzzyNameMatch: fuzzyNameMatch,
  _bowlerIdFromMap: bowlerIdFromMap,
  _resolvePlayer: resolvePlayer
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

// ─── resolvePlayer integration (in-memory DB) ─────────────────────────────────

function makeDb(rows) {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE players (player_id INTEGER PRIMARY KEY, name TEXT, display_name TEXT)')
  const ins = db.prepare('INSERT INTO players (player_id, name, display_name) VALUES (?, ?, ?)')
  for (const [id, name, dn] of rows) ins.run(id, name, dn)
  return db
}

describe('resolvePlayer', () => {
  it('resolves by exact name match', () => {
    const db = makeDb([[1, 'Leo Price', null]])
    expect(resolvePlayer(db, 'Leo Price')).toMatchObject({ player_id: 1, matched: true })
  })

  it('resolves by display_name match', () => {
    const db = makeDb([[1, 'L Price', 'Leo Price']])
    expect(resolvePlayer(db, 'Leo Price')).toMatchObject({ player_id: 1, matched: true })
  })

  it('resolves dotted initial via normalised SQL — "L. Price" finds "L Price"', () => {
    const db = makeDb([[1, 'L Price', null]])
    expect(resolvePlayer(db, 'L. Price')).toMatchObject({ player_id: 1, matched: true })
  })

  it('resolves initial to full forename via fuzzy match — "L Price" finds "Leo Price"', () => {
    const db = makeDb([[1, 'Leo Price', null]])
    expect(resolvePlayer(db, 'L Price')).toMatchObject({ player_id: 1, matched: true, fuzzy: true })
  })

  it('resolves full forename to initial via fuzzy match — "Leo Price" finds "L Price"', () => {
    const db = makeDb([[1, 'L Price', null]])
    expect(resolvePlayer(db, 'Leo Price')).toMatchObject({
      player_id: 1,
      matched: true,
      fuzzy: true
    })
  })

  it('does not resolve an unknown name', () => {
    const db = makeDb([[1, 'Leo Price', null]])
    expect(resolvePlayer(db, 'Unknown Player')).toMatchObject({ player_id: null, matched: false })
  })
})

// ─── bowlerMap key normalisation ──────────────────────────────────────────────

describe('bowlerMap key normalisation', () => {
  it('normaliseName key matches dotted-initial over header', () => {
    // Simulates bowlerMap built with normaliseName() and lookup via bowlerIdFromMap()
    const bowlerMap = { [normaliseName('L Price')]: 99 }
    expect(bowlerIdFromMap(bowlerMap, 'L. Price')).toBe(99)
  })

  it('normaliseName key matches full-forename over header when map has initial', () => {
    const bowlerMap = { [normaliseName('D Cottrell')]: 7 }
    expect(bowlerIdFromMap(bowlerMap, 'Dylan Cottrell')).toBe(7)
  })
})
