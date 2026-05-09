const { oversToLegalBalls, ballsToOvers } = require('./cricket')

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
