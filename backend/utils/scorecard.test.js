'use strict'

const {
  parseHowOut,
  formatDismissal,
  parseCatcher,
  nameFromDesc,
  getPhaseStats
} = require('./scorecard')

describe('parseHowOut', () => {
  test('returns null for empty input', () => {
    expect(parseHowOut(null)).toBeNull()
    expect(parseHowOut('')).toBeNull()
  })

  test('parses run out with fielder', () => {
    const r = parseHowOut('run out (Jones)')
    expect(r).toEqual({ type: 'Run out', fielder: 'Jones', bowler: null })
  })

  test('parses run out without fielder', () => {
    const r = parseHowOut('run out')
    expect(r).toEqual({ type: 'Run out', fielder: null, bowler: null })
  })

  test('parses c&b', () => {
    const r = parseHowOut('c&b Smith')
    expect(r).toEqual({ type: 'CaughtAndBowled', fielder: null, bowler: 'Smith' })
  })

  test('parses caught and bowled (long form)', () => {
    const r = parseHowOut('caught and bowled Williams')
    expect(r).toEqual({ type: 'CaughtAndBowled', fielder: null, bowler: 'Williams' })
  })

  test('parses lbw with bowler', () => {
    const r = parseHowOut('lbw b Taylor')
    expect(r).toEqual({ type: 'LBW', fielder: null, bowler: 'Taylor' })
  })

  test('parses lbw without bowler', () => {
    const r = parseHowOut('lbw')
    expect(r).toEqual({ type: 'LBW', fielder: null, bowler: null })
  })

  test('parses stumped with fielder and bowler', () => {
    const r = parseHowOut('st Jones b Smith')
    expect(r).toEqual({ type: 'Stumped', fielder: 'Jones', bowler: 'Smith' })
  })

  test('parses caught with fielder and bowler', () => {
    const r = parseHowOut('ct Jones b Smith')
    expect(r).toEqual({ type: 'Caught', fielder: 'Jones', bowler: 'Smith' })
  })

  test('parses caught (long form)', () => {
    const r = parseHowOut('caught Jones b Smith')
    expect(r).toEqual({ type: 'Caught', fielder: 'Jones', bowler: 'Smith' })
  })

  test('parses bowled with bowler', () => {
    const r = parseHowOut('b Smith')
    expect(r).toEqual({ type: 'Bowled', fielder: null, bowler: 'Smith' })
  })

  test('parses bowled (long form)', () => {
    const r = parseHowOut('bowled Smith')
    expect(r).toEqual({ type: 'Bowled', fielder: null, bowler: 'Smith' })
  })

  test('returns null for unrecognised text', () => {
    expect(parseHowOut('did not bat')).toBeNull()
  })
})

describe('formatDismissal', () => {
  test('Caught with fielder and bowler', () => {
    expect(formatDismissal('Caught', 'Jones', 'Smith')).toBe('ct Jones b Smith')
  })

  test('Caught with bowler only', () => {
    expect(formatDismissal('Caught', null, 'Smith')).toBe('caught b Smith')
  })

  test('Caught with neither', () => {
    expect(formatDismissal('Caught', null, null)).toBe('caught')
  })

  test('CaughtAndBowled with bowler', () => {
    expect(formatDismissal('CaughtAndBowled', null, 'Smith')).toBe('c&b Smith')
  })

  test('CaughtAndBowled without bowler', () => {
    expect(formatDismissal('CaughtAndBowled', null, null)).toBe('c&b')
  })

  test('Bowled with bowler', () => {
    expect(formatDismissal('Bowled', null, 'Smith')).toBe('b Smith')
  })

  test('Bowled without bowler', () => {
    expect(formatDismissal('Bowled', null, null)).toBe('bowled')
  })

  test('LBW with bowler', () => {
    expect(formatDismissal('LBW', null, 'Smith')).toBe('lbw b Smith')
  })

  test('LBW without bowler', () => {
    expect(formatDismissal('LBW', null, null)).toBe('lbw')
  })

  test('Stumped with fielder and bowler', () => {
    expect(formatDismissal('Stumped', 'Jones', 'Smith')).toBe('st Jones b Smith')
  })

  test('Stumped without both', () => {
    expect(formatDismissal('Stumped', null, null)).toBe('stumped')
  })

  test('RunOut with fielder', () => {
    expect(formatDismissal('RunOut', 'Jones', null)).toBe('run out (Jones)')
  })

  test('Run out (spaced) without fielder', () => {
    expect(formatDismissal('Run out', null, null)).toBe('run out')
  })

  test('Retired', () => {
    expect(formatDismissal('Retired', null, null)).toBe('retired not out')
  })

  test('unknown method returns method', () => {
    expect(formatDismissal('Hit wicket', null, null)).toBe('Hit wicket')
  })

  test('null method returns "out"', () => {
    expect(formatDismissal(null, null, null)).toBe('out')
  })
})

describe('parseCatcher', () => {
  test('returns null for empty input', () => {
    expect(parseCatcher(null)).toBeNull()
    expect(parseCatcher('')).toBeNull()
  })

  test('extracts catcher from "ct Name b Bowler"', () => {
    expect(parseCatcher('ct Zayd Akhtar b Sebastian Mills')).toBe('Zayd Akhtar')
  })

  test('extracts bowler from c&b notation', () => {
    expect(parseCatcher('c&b Smith')).toBe('Smith')
  })

  test('extracts bowler from "caught and bowled" notation', () => {
    expect(parseCatcher('caught and bowled Williams')).toBe('Williams')
  })
})

describe('getPhaseStats', () => {
  const emptyDb = { prepare: () => ({ all: () => [] }) }

  test('returns empty array when fixture has no deliveries', () => {
    expect(getPhaseStats(emptyDb, 9999, 20)).toEqual([])
  })
})

describe('nameFromDesc', () => {
  test('returns null for empty input', () => {
    expect(nameFromDesc(null, 'bowler')).toBeNull()
    expect(nameFromDesc('', 'bowler')).toBeNull()
  })

  test('extracts bowler from delivery description', () => {
    expect(nameFromDesc('Smith to Jones: 1 run', 'bowler')).toBe('Smith')
  })

  test('extracts batter from delivery description', () => {
    expect(nameFromDesc('Smith to Jones: 1 run', 'batter')).toBe('Jones')
  })

  test('returns null when description format does not match', () => {
    expect(nameFromDesc('no match here', 'bowler')).toBeNull()
  })
})
