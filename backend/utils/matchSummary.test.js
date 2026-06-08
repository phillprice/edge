'use strict'
const path = require('path')
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'test.sqlite')
const { _test: { shortName, fmtScore, resultEmoji }, backfillFixtureSummary } = require('./matchSummary')

describe('shortName', () => {
  it('strips "Woking & Horsell Cricket Club -"', () => {
    expect(shortName('Woking & Horsell Cricket Club - Seniors')).toBe('Seniors')
  })
  it('strips "Woking & Horsell CC"', () => {
    expect(shortName('Woking & Horsell CC')).toBe('')
  })
  it('strips "Woking and Horsell CC"', () => {
    expect(shortName('Woking and Horsell CC')).toBe('')
  })
  it('leaves unrelated names unchanged', () => {
    expect(shortName('Epsom CC')).toBe('Epsom CC')
    expect(shortName('Weybridge Vandals')).toBe('Weybridge Vandals')
  })
  it('handles null', () => expect(shortName(null)).toBeNull())
  it('handles empty string', () => expect(shortName('')).toBe(''))
  it('collapses extra spaces after removal', () => {
    expect(shortName('Woking & Horsell CC  Whirlwinds')).toBe('Whirlwinds')
  })
})

describe('fmtScore', () => {
  it('formats score with wickets and overs', () => {
    expect(fmtScore(120, 4, '20.0')).toBe('120/4 (20.0 ov)')
  })
  it('formats score without wickets', () => {
    expect(fmtScore(80, null, '16.3')).toBe('80 (16.3 ov)')
  })
  it('returns null for null score', () => {
    expect(fmtScore(null, 4, '20.0')).toBeNull()
  })
  it('handles zero score', () => {
    expect(fmtScore(0, 0, '0.0')).toBe('0/0 (0.0 ov)')
  })

  describe('pairs format', () => {
    it('renders net score as "Net N (overs ov)"', () => {
      // net = raw + startingScore - wickets * 5 = 175 + 200 - 3*5 = 360
      expect(fmtScore(175, 3, '20.0', 'pairs', 200)).toBe('Net 360 (20.0 ov)')
    })
    it('handles zero starting score', () => {
      // net = 150 + 0 - 2*5 = 140
      expect(fmtScore(150, 2, '20.0', 'pairs', 0)).toBe('Net 140 (20.0 ov)')
    })
    it('handles null startingScore gracefully', () => {
      // net = 100 + 0 - 0 = 100
      expect(fmtScore(100, 0, '20.0', 'pairs', null)).toBe('Net 100 (20.0 ov)')
    })
    it('non-pairs format is unchanged when format param provided', () => {
      expect(fmtScore(120, 4, '20.0', 'standard', 0)).toBe('120/4 (20.0 ov)')
    })
    it('returns null for null score regardless of format', () => {
      expect(fmtScore(null, 3, '20.0', 'pairs', 200)).toBeNull()
    })
  })
})

describe('resultEmoji', () => {
  it('returns ✅ when WHCC team won', () => {
    expect(resultEmoji('WHCC Whirlwinds won by 30 runs')).toBe('✅')
    expect(resultEmoji('Woking & Horsell won by 5 wickets')).toBe('✅')
    expect(resultEmoji('horsell CC won by 2 wickets')).toBe('✅')
    expect(resultEmoji('WHCC Hurricanes won by 10 runs')).toBe('✅')
  })
  it('returns ❌ when opposition won', () => {
    expect(resultEmoji('Epsom CC won by 20 runs')).toBe('❌')
    expect(resultEmoji('Weybridge won by 3 wickets')).toBe('❌')
  })
  it('returns ❌ for look-alike opposition clubs (#122 regression)', () => {
    // play-cricket result text names the WINNER; these are WHCC losses, not wins.
    expect(resultEmoji('Old Woking CC - Under 11 A - Won')).toBe('❌')
    expect(resultEmoji('Camberley CC - Girls Under 14 Lightning - Won')).toBe('❌')
    expect(resultEmoji('Horsley & Send CC - Under 10 Hurricanes - Won')).toBe('❌')
  })
  it('returns 🤝 for tie/draw/no result', () => {
    expect(resultEmoji('Tied')).toBe('🤝')
    expect(resultEmoji('Match drawn')).toBe('🤝')
    expect(resultEmoji('No result')).toBe('🤝')
  })
  it('returns ➖ for abandoned/other', () => {
    expect(resultEmoji('Match abandoned')).toBe('➖')
    expect(resultEmoji('')).toBe('➖')
    expect(resultEmoji(null)).toBe('➖')
  })
})

// Regression: a fixture ingested ball-by-ball before its result was published has
// full delivery data but NULL summary columns (home_score, result, …). The detail
// page computes a result live from the scorecards, but the match list/season views
// read the summary columns and showed nothing — the two views disagreed.
// backfillFixtureSummary derives the summary from the deliveries so they agree.
describe('backfillFixtureSummary', () => {
  const { seed } = require('../scripts/seed-test-db')
  let db
  beforeAll(() => { seed(process.env.DB_PATH); db = require('../db/schema').getDb() })

  // Fixture with two innings of deliveries and NULL summary columns. WHCC bat
  // first (innings 1, batters tagged WHCC); opposition chase (innings 2, NULL team).
  function makeFixture(fid, { format = 'standard', whccRuns, oppRuns, whccWkts, oppWkts }) {
    db.prepare(`INSERT INTO fixtures (fixture_id, home_team, away_team, format, result, home_score)
                VALUES (?, 'Woking & Horsell CC - U10 Whirlwinds', 'Effingham CC - Under 10', ?, NULL, NULL)`).run(fid, format)
    const r1 = Number(fid) * 10 + 1, r2 = Number(fid) * 10 + 2
    db.prepare('INSERT INTO innings (result_id, fixture_id, innings_order) VALUES (?, ?, 1)').run(r1, fid)
    db.prepare('INSERT INTO innings (result_id, fixture_id, innings_order) VALUES (?, ?, 2)').run(r2, fid)
    db.prepare("INSERT OR IGNORE INTO players (player_id, name, team) VALUES (901, 'WHCC Batter', 'Woking & Horsell CC - U10 Whirlwinds')").run()
    db.prepare("INSERT OR IGNORE INTO players (player_id, name, team) VALUES (902, 'Opp Batter', NULL)").run()

    const add = (resultId, batterId, runs, wkts) => {
      let over = 0, b = 0
      const push = (rb, dismissed) => {
        b++; if (b > 6) { b = 1; over++ }
        db.prepare(`INSERT INTO deliveries (result_id, innings_number, over_no, ball_no, batter_id, bowler_id, runs_bat, runs_extra, dismissed_batter_id)
                    VALUES (?, 1, ?, ?, ?, 999, ?, 0, ?)`).run(resultId, over, b, batterId, rb, dismissed)
      }
      for (let i = 0; i < runs; i++) push(1, null)
      for (let i = 0; i < wkts; i++) push(0, batterId)
    }
    add(r1, 901, whccRuns, whccWkts)
    add(r2, 902, oppRuns, oppWkts)
  }

  it('derives summary + names the winning team when WHCC lose the chase', () => {
    makeFixture('700001', { whccRuns: 79, whccWkts: 7, oppRuns: 80, oppWkts: 3 })
    expect(backfillFixtureSummary(db, '700001')).toBe(true)
    const f = db.prepare('SELECT * FROM fixtures WHERE fixture_id=?').get('700001')
    expect(f.home_score).toBe('79')
    expect(f.away_score).toBe('80')
    expect(f.home_wickets).toBe('7')
    expect(f.away_wickets).toBe('3')
    expect(f.result).toBe('Effingham CC - Under 10 - Won')
  })

  it('names WHCC as winner when they defend', () => {
    makeFixture('700002', { whccRuns: 120, whccWkts: 4, oppRuns: 90, oppWkts: 10 })
    expect(backfillFixtureSummary(db, '700002')).toBe(true)
    expect(db.prepare('SELECT result FROM fixtures WHERE fixture_id=?').get('700002').result)
      .toBe('Woking & Horsell CC - U10 Whirlwinds - Won')
  })

  it('reports a tie on equal scores', () => {
    makeFixture('700003', { whccRuns: 100, whccWkts: 5, oppRuns: 100, oppWkts: 6 })
    expect(backfillFixtureSummary(db, '700003')).toBe(true)
    expect(db.prepare('SELECT result FROM fixtures WHERE fixture_id=?').get('700003').result).toBe('Match Tied')
  })

  it('never overwrites a fixture that already has a scraped summary', () => {
    db.prepare(`INSERT INTO fixtures (fixture_id, home_team, away_team, format, result, home_score, away_score)
                VALUES ('700004', 'Woking & Horsell CC - U10 Whirlwinds', 'Effingham CC - Under 10', 'standard', 'Scraped - Won', '50', '40')`).run()
    expect(backfillFixtureSummary(db, '700004')).toBe(false)
    expect(db.prepare('SELECT result FROM fixtures WHERE fixture_id=?').get('700004').result).toBe('Scraped - Won')
  })

  it('leaves an in-progress match (single innings) alone', () => {
    db.prepare(`INSERT INTO fixtures (fixture_id, home_team, away_team, format, result, home_score)
                VALUES ('700005', 'Woking & Horsell CC - U10 Whirlwinds', 'Effingham CC - Under 10', 'standard', NULL, NULL)`).run()
    db.prepare("INSERT INTO innings (result_id, fixture_id, innings_order) VALUES (7000051, '700005', 1)").run()
    db.prepare("INSERT OR IGNORE INTO players (player_id, name, team) VALUES (901, 'WHCC Batter', 'Woking & Horsell CC - U10 Whirlwinds')").run()
    db.prepare(`INSERT INTO deliveries (result_id, innings_number, over_no, ball_no, batter_id, bowler_id, runs_bat, runs_extra, dismissed_batter_id)
                VALUES (7000051, 1, 0, 1, 901, 999, 4, 0, NULL)`).run()
    expect(backfillFixtureSummary(db, '700005')).toBe(false)
    expect(db.prepare('SELECT home_score FROM fixtures WHERE fixture_id=?').get('700005').home_score).toBeNull()
  })
})
