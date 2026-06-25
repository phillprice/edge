'use strict'

const {
  parseBall,
  parseBattingLine,
  parseBowlingTotals,
  parseScorecard
} = require('./pdfScorecard')

// ─── parseBall ────────────────────────────────────────────────────────────────

describe('parseBall', () => {
  it('parses a dot ball', () => {
    expect(parseBall('•')).toEqual({
      runs_bat: 0,
      runs_extra: 0,
      extras_type: null,
      is_wicket: false
    })
  })

  it('parses a wicket', () => {
    expect(parseBall('W')).toEqual({
      runs_bat: 0,
      runs_extra: 0,
      extras_type: null,
      is_wicket: true
    })
  })

  it('parses a retired batter', () => {
    const r = parseBall('R')
    expect(r.is_wicket).toBe(false)
    expect(r.retired).toBe(true)
  })

  it.each([
    ['1', 1],
    ['4', 4],
    ['6', 6]
  ])('parses %s bat runs', (token, runs) => {
    expect(parseBall(token)).toEqual({
      runs_bat: runs,
      runs_extra: 0,
      extras_type: null,
      is_wicket: false
    })
  })

  it('parses a wide (extras_type=2)', () => {
    expect(parseBall('1wd')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 2,
      is_wicket: false
    })
    expect(parseBall('2wd')).toEqual({
      runs_bat: 0,
      runs_extra: 2,
      extras_type: 2,
      is_wicket: false
    })
  })

  it('parses a no-ball (extras_type=1)', () => {
    expect(parseBall('1nb')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 1,
      is_wicket: false
    })
  })

  it('parses a no-ball with bat runs (extras_type=1)', () => {
    expect(parseBall('1nb+4')).toEqual({
      runs_bat: 4,
      runs_extra: 1,
      extras_type: 1,
      is_wicket: false
    })
  })

  it('parses a leg bye (extras_type=4)', () => {
    expect(parseBall('lb')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 4,
      is_wicket: false
    })
    expect(parseBall('2lb')).toEqual({
      runs_bat: 0,
      runs_extra: 2,
      extras_type: 4,
      is_wicket: false
    })
  })

  it('parses a bye (extras_type=3)', () => {
    expect(parseBall('b')).toEqual({ runs_bat: 0, runs_extra: 1, extras_type: 3, is_wicket: false })
    expect(parseBall('4b')).toEqual({
      runs_bat: 0,
      runs_extra: 4,
      extras_type: 3,
      is_wicket: false
    })
  })

  it('returns null for empty, unknown, or null token', () => {
    expect(parseBall('')).toBeNull()
    expect(parseBall('xyz')).toBeNull()
    expect(parseBall(null)).toBeNull()
  })
})

// ─── parseBattingLine ─────────────────────────────────────────────────────────
// PDF text uses space-separated stat columns: "R B 4s 6s MINS SR"
// e.g. "A Batter b Rory Smith 6 4 0 0 - 150.00"

describe('parseBattingLine', () => {
  it('parses a bowled dismissal', () => {
    const r = parseBattingLine('A Batter b Rory Smith 6 4 0 0 - 150.00')
    expect(r.name).toBe('A Batter')
    expect(r.runs).toBe(6)
    expect(r.balls).toBe(4)
    expect(r.how_out).toBe('bowled')
    expect(r.not_out).toBe(false)
  })

  it('parses a caught dismissal', () => {
    const r = parseBattingLine('A Batter c Jones b Rory Smith 6 4 0 0 - 150.00')
    expect(r.name).toBe('A Batter')
    expect(r.runs).toBe(6)
    expect(r.how_out).toBe('caught')
  })

  it('parses a not-out batter', () => {
    const r = parseBattingLine('H Price not out 10 9 0 0 - 111.11')
    expect(r.name).toBe('H Price')
    expect(r.runs).toBe(10)
    expect(r.balls).toBe(9)
    expect(r.not_out).toBe(true)
    expect(r.how_out).toBe('not out')
  })

  it('parses a retired batter', () => {
    const r = parseBattingLine('M James retired n.o. 32 38 3 0 - 84.21')
    expect(r.name).toBe('M James')
    expect(r.runs).toBe(32)
    expect(r.balls).toBe(38)
    expect(r.fours).toBe(3)
    expect(r.not_out).toBe(true)
    expect(r.how_out).toBe('retired')
  })

  it('parses a zero-run batter', () => {
    const r = parseBattingLine('L Price b Rory Smith 0 1 0 0 - 0.00')
    expect(r.name).toBe('L Price')
    expect(r.runs).toBe(0)
    expect(r.balls).toBe(1)
  })

  it('parses a batter with numeric MINS column (not a dash)', () => {
    const r = parseBattingLine('F Hodson not out 0 5 0 0 0 0.00')
    expect(r.name).toBe('F Hodson')
    expect(r.runs).toBe(0)
    expect(r.balls).toBe(5)
    expect(r.not_out).toBe(true)
  })

  it('parses fours and sixes', () => {
    const r = parseBattingLine('J Spiler retired n.o. 30 29 4 0 - 103.45')
    expect(r.fours).toBe(4)
    expect(r.sixes).toBe(0)
  })

  it('parses ball sequence embedded in name field (retired)', () => {
    const r = parseBattingLine(
      'M James 2..1....2..1..1...14.24112111.11...14 retired n.o. 32 38 3 0 - 84.21'
    )
    expect(r.name).toBe('M James')
    expect(r.runs).toBe(32)
    expect(r.balls).toBe(38)
  })

  it('parses did-not-bat with text glued to name', () => {
    const r = parseBattingLine('D Cottrelldid not bat')
    expect(r.name).toBe('D Cottrell')
    expect(r.did_not_bat).toBe(true)
  })

  it('parses did-not-bat with space before text', () => {
    const r = parseBattingLine('K Shergill did not bat')
    expect(r.name).toBe('K Shergill')
    expect(r.did_not_bat).toBe(true)
  })

  it('returns null for lines with no recognisable stats pattern', () => {
    expect(parseBattingLine('Extras 10')).toBeNull()
    expect(parseBattingLine('Total 120/6')).toBeNull()
  })
})

// ─── parseBowlingTotals ───────────────────────────────────────────────────────
// PDF text uses space-separated columns: "O M R W ECON [extras]"
// May have extra leading values from per-over column data in the table.

describe('parseBowlingTotals', () => {
  it('parses standard figures — O=3 M=0 R=20 W=2 2wd', () => {
    const r = parseBowlingTotals('3 0 20 2 6.67 2wd')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(3)
    expect(r.maidens).toBe(0)
    expect(r.runs).toBe(20)
    expect(r.wickets).toBe(2)
    expect(r.wides).toBe(2)
    expect(r.no_balls).toBe(0)
  })

  it('parses figures with extra leading per-over values', () => {
    const r = parseBowlingTotals('15 3 12 2 0 27 0 13.50 3wd')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(2)
    expect(r.runs).toBe(27)
    expect(r.wickets).toBe(0)
  })

  it('parses maiden overs', () => {
    const r = parseBowlingTotals('2 1 4 0 2.00')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(2)
    expect(r.maidens).toBe(1)
    expect(r.runs).toBe(4)
  })

  it('parses no-ball extras', () => {
    const r = parseBowlingTotals('2 0 10 1 5.00 1nb')
    expect(r).not.toBeNull()
    expect(r.no_balls).toBe(1)
  })

  it('parses fractional overs (1.4 overs)', () => {
    const r = parseBowlingTotals('1.4 0 7 0 4.20 4nb')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(1.4)
    expect(r.runs).toBe(7)
    expect(r.no_balls).toBe(4)
  })

  it('parses extra leading per-over values before O M R W (Barnaby Webb case)', () => {
    const r = parseBowlingTotals('1 2 1 7 1 3.50')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(2)
    expect(r.maidens).toBe(1)
    expect(r.runs).toBe(7)
    expect(r.wickets).toBe(1)
  })

  it('returns null when no decimal point is present', () => {
    expect(parseBowlingTotals('nodothere')).toBeNull()
  })

  it('returns null when fewer than 4 parts precede the economy rate', () => {
    expect(parseBowlingTotals('1 2 3 4.56')).toBeNull()
  })
})

// ─── parseScorecard (integration) ────────────────────────────────────────────

const SAMPLE_TEXT = `
1 May 2026

Alpha CC - 1st Innings (Batting)
Name R B 4s 6s MINS SR
A Batter b Rory Smith 6 4 0 0 - 150.00
B Hitter did not bat
Extras 0
Total 6/1
Fall of Wickets:
6/1 (A Batter, 0.6 overs)

Alpha CC - 1st Innings (Bowling)
Name 1 2 3 O M R W ECON EXTRAS
Rory Smith
R
W
NB
WD
2 0 10 1 5.00

Alpha CC - 1st Innings (Over-by-over)
Over Runs Wickets Bowler(s) Ball-by-ball
1 0 0 A Batter 6 •

Beta XI - 1st Innings (Batting)
Name R B 4s 6s MINS SR
Rory Smith not out 6 4 0 0 - 150.00
Extras 0
Total 6/0

Beta XI - 1st Innings (Bowling)
Name 1 2 3 O M R W ECON EXTRAS
Alpha Player
R
W
NB
WD
2 0 10 1 5.00

Beta XI - 1st Innings (Over-by-over)
Over Runs Wickets Bowler(s) Ball-by-ball
1 0 0 Rory Smith 6 •
`

describe('parseScorecard', () => {
  it('identifies home and away teams from innings headers', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    expect(r.home_team).toBe('Alpha CC')
    expect(r.away_team).toBe('Beta XI')
  })

  it('extracts the match date', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    expect(r.match_date).toMatch(/1 May 2026/)
  })

  it('parses batting entries for the first innings', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    const batter = r.innings[0].batting.find((b) => b.name === 'A Batter')
    expect(batter).toBeDefined()
    expect(batter.runs).toBe(6)
    expect(batter.balls).toBe(4)
  })

  it('parses did-not-bat entries', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    const dnb = r.innings[0].batting.find((b) => b.name === 'B Hitter')
    expect(dnb).toBeDefined()
    expect(dnb.did_not_bat).toBe(true)
  })

  it('parses fall of wickets', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    const fow = r.innings[0].fallOfWickets
    expect(fow).toHaveLength(1)
    expect(fow[0].batter_name).toBe('A Batter')
    expect(fow[0].over_no).toBe(0)
  })

  it('parses bowling figures', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    const bowler = r.innings[0].bowling.find((b) => b.name === 'Rory Smith')
    expect(bowler).toBeDefined()
    expect(bowler.overs).toBe(2)
    expect(bowler.runs).toBe(10)
    expect(bowler.wickets).toBe(1)
  })

  it('parses over-by-over ball sequences', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    const overs = r.innings[0].overs
    expect(overs).toHaveLength(1)
    expect(overs[0].over_no).toBe(0)
    expect(overs[0].balls.length).toBeGreaterThan(0)
  })

  it('parses both innings', () => {
    const r = parseScorecard(SAMPLE_TEXT)
    expect(r.innings).toHaveLength(2)
    expect(r.innings[1].batting_team).toBe('Beta XI')
  })

  it('throws when fewer than two team headers are found', () => {
    expect(() => parseScorecard('no innings headers here')).toThrow(
      'Could not identify two team innings'
    )
  })
})
