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

  it('parses a wide', () => {
    expect(parseBall('1wd')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 3,
      is_wicket: false
    })
    expect(parseBall('2wd')).toEqual({
      runs_bat: 0,
      runs_extra: 2,
      extras_type: 3,
      is_wicket: false
    })
  })

  it('parses a no-ball', () => {
    expect(parseBall('1nb')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 2,
      is_wicket: false
    })
  })

  it('parses a no-ball with bat runs', () => {
    expect(parseBall('1nb+4')).toEqual({
      runs_bat: 4,
      runs_extra: 1,
      extras_type: 2,
      is_wicket: false
    })
  })

  it('parses a leg bye', () => {
    expect(parseBall('lb')).toEqual({
      runs_bat: 0,
      runs_extra: 1,
      extras_type: 1,
      is_wicket: false
    })
    expect(parseBall('2lb')).toEqual({
      runs_bat: 0,
      runs_extra: 2,
      extras_type: 1,
      is_wicket: false
    })
  })

  it('parses a bye', () => {
    expect(parseBall('b')).toEqual({ runs_bat: 0, runs_extra: 1, extras_type: 0, is_wicket: false })
    expect(parseBall('4b')).toEqual({
      runs_bat: 0,
      runs_extra: 4,
      extras_type: 0,
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
// Digit format: RUNSBALLS FOURSSIXES concatenated before hyphen+SR.
// e.g. 6 runs / 4 balls / 0 fours / 0 sixes / SR 150.00 → "60400-150.00"

describe('parseBattingLine', () => {
  it('parses a bowled dismissal', () => {
    const r = parseBattingLine('A Batter b Rory Smith 60400-150.00')
    expect(r.name).toBe('A Batter')
    expect(r.runs).toBe(6)
    expect(r.balls).toBe(4)
    expect(r.how_out).toBe('bowled')
    expect(r.not_out).toBe(false)
  })

  it('parses a caught dismissal', () => {
    const r = parseBattingLine('A Batter c Jones b Rory Smith 60400-150.00')
    expect(r.name).toBe('A Batter')
    expect(r.runs).toBe(6)
    expect(r.how_out).toBe('caught')
  })

  it('parses a not-out batter (digits glued to "not out")', () => {
    const r = parseBattingLine('H Price not out100900-111.11')
    expect(r.name).toBe('H Price')
    expect(r.runs).toBe(10)
    expect(r.balls).toBe(9)
    expect(r.not_out).toBe(true)
    expect(r.how_out).toBe('not out')
  })

  it('parses a retired batter', () => {
    const r = parseBattingLine('M James retired n.o.323800-84.21')
    expect(r.name).toBe('M James')
    expect(r.runs).toBe(32)
    expect(r.balls).toBe(38)
    expect(r.not_out).toBe(true)
    expect(r.how_out).toBe('retired')
  })

  it('parses a zero-run batter (sr=0 special case)', () => {
    const r = parseBattingLine('L Price b Rory Smith 01-0.00')
    expect(r.name).toBe('L Price')
    expect(r.runs).toBe(0)
    expect(r.balls).toBe(1)
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

describe('parseBowlingTotals', () => {
  it('parses standard figures — O=3 M=0 R=20 W=2 2wd', () => {
    const r = parseBowlingTotals('302026.672wd')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(3)
    expect(r.maidens).toBe(0)
    expect(r.runs).toBe(20)
    expect(r.wickets).toBe(2)
    expect(r.wides).toBe(2)
    expect(r.no_balls).toBe(0)
  })

  it('parses figures with two-digit ECO integer (Samuel Arnold case)', () => {
    const r = parseBowlingTotals('2027013.503wd')
    expect(r).not.toBeNull()
    expect(r.overs).toBe(2)
    expect(r.runs).toBe(27)
    expect(r.wickets).toBe(0)
  })

  it('parses maiden overs', () => {
    // O=2 M=1 R=4 W=2 ECO=2.00
    const r = parseBowlingTotals('214022.00')
    expect(r).not.toBeNull()
    expect(r.maidens).toBeGreaterThanOrEqual(1)
  })

  it('parses no-ball extras', () => {
    // O=2 M=0 R=10 W=1 ECO=5.00 1nb
    const r = parseBowlingTotals('201015.001nb')
    expect(r).not.toBeNull()
    expect(r.no_balls).toBe(1)
  })

  it('returns null when no decimal point is present', () => {
    expect(parseBowlingTotals('nodothere')).toBeNull()
  })

  it('returns null when decimal part is not two digits', () => {
    expect(parseBowlingTotals('10.1')).toBeNull()
  })
})

// ─── parseScorecard (integration) ────────────────────────────────────────────

const SAMPLE_TEXT = `
1 May 2026

Alpha CC - 1st Innings (Batting)
Name
A Batter b Rory Smith 60400-150.00
B Hitter did not bat
Extras 0
Total 6/1
Fall of Wickets
6/1 (A Batter, 0.6 overs)

Alpha CC - 1st Innings (Bowling)
Name
Rory Smith
201015.00

Alpha CC - 1st Innings (Over-by-over)
1101A Batter 6 •

Beta XI - 1st Innings (Batting)
Name
Rory Smith not out60400-150.00
Extras 0
Total 6/0

Beta XI - 1st Innings (Bowling)
Name
Alpha Player
201015.00

Beta XI - 1st Innings (Over-by-over)
1101Rory Smith 6 •
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
    expect(fow[0].over_no).toBe(1)
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
    expect(overs[0].over_no).toBe(1)
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
