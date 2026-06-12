const { toIsoDate, oversToLegalBalls, ballsToOvers, classifyDismissal } = require('./cricket')

describe('oversToLegalBalls', () => {
  it('converts whole overs', () => expect(oversToLegalBalls('5.0')).toBe(30))
  it('converts partial overs', () => expect(oversToLegalBalls('5.3')).toBe(33))
  it('handles integer input', () => expect(oversToLegalBalls('10')).toBe(60))
  it('handles zero', () => expect(oversToLegalBalls('0')).toBe(0))
  it('handles null/undefined', () => {
    expect(oversToLegalBalls(null)).toBe(0)
    expect(oversToLegalBalls(undefined)).toBe(0)
  })
  it('clamps remainder to 5 (no 6th ball in an over)', () => {
    expect(oversToLegalBalls('3.6')).toBe(18 + 5)
    expect(oversToLegalBalls('3.9')).toBe(18 + 5)
  })
  it('handles numeric input', () => expect(oversToLegalBalls(4)).toBe(24))
})

describe('ballsToOvers', () => {
  it('converts whole overs', () => expect(ballsToOvers(18)).toBe('3.0'))
  it('converts partial overs', () => expect(ballsToOvers(19)).toBe('3.1'))
  it('handles zero/null', () => {
    expect(ballsToOvers(0)).toBe('0.0')
    expect(ballsToOvers(null)).toBe('0.0')
  })
  it('roundtrips with oversToLegalBalls', () => {
    expect(oversToLegalBalls(ballsToOvers(37))).toBe(37)
    expect(oversToLegalBalls(ballsToOvers(60))).toBe(60)
  })
})

describe('toIsoDate', () => {
  it('passes through ISO date', () => expect(toIsoDate('2025-08-24')).toBe('2025-08-24'))
  it('passes through ISO datetime', () =>
    expect(toIsoDate('2025-08-24T12:00:00')).toBe('2025-08-24'))
  it('converts DD/MM/YYYY', () => expect(toIsoDate('17/05/2025')).toBe('2025-05-17'))
  it('converts long English date with weekday', () =>
    expect(toIsoDate('Sunday 17th May 2025')).toBe('2025-05-17'))
  it('converts long English date single-digit day', () =>
    expect(toIsoDate('Tuesday 8th July 2025')).toBe('2025-07-08'))
  it('converts long English date Saturday', () =>
    expect(toIsoDate('Saturday 7th June 2025')).toBe('2025-06-07'))
  it('handles end-of-month ordinals', () =>
    expect(toIsoDate('Sunday 31st August 2025')).toBe('2025-08-31'))
  it('returns null for null', () => expect(toIsoDate(null)).toBeNull())
  it('returns null for unrecognised format', () => expect(toIsoDate('not a date')).toBeNull())
})

describe('classifyDismissal', () => {
  it('run out', () => expect(classifyDismissal('Run out (Jones)', '')).toBe('Run out'))
  it('lbw', () => expect(classifyDismissal('LBW b Smith', '')).toBe('LBW'))
  it('caught (ct)', () => expect(classifyDismissal('ct Jones b Smith', '')).toBe('Caught'))
  it('caught (caught)', () => expect(classifyDismissal('Caught Jones b Smith', '')).toBe('Caught'))
  it('stumped', () => expect(classifyDismissal('Stumped Jones b Smith', '')).toBe('Stumped'))
  it('st shorthand', () => expect(classifyDismissal('st Jones b Smith', '')).toBe('Stumped'))
  it('bowled', () => expect(classifyDismissal('Bowled Smith', '')).toBe('Bowled'))
  it('falls back to sDesc', () => expect(classifyDismissal('', 'run out')).toBe('Run out'))
  it('null inputs', () => expect(classifyDismissal(null, null)).toBe('Other'))
  it('unknown method', () => expect(classifyDismissal('hit wicket', '')).toBe('Other'))
  it('c&b short form', () => expect(classifyDismissal('c&b Smith', '')).toBe('CaughtAndBowled'))
  it('caught and bowled long form', () =>
    expect(classifyDismissal('caught and bowled Smith', '')).toBe('CaughtAndBowled'))
  it('ct and b form', () => expect(classifyDismissal('ct and b Smith', '')).toBe('CaughtAndBowled'))
  it('c&b not misclassified as Caught', () =>
    expect(classifyDismissal('C&B Jones', '')).not.toBe('Caught'))
})
