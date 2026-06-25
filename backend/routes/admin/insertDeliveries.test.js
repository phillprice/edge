'use strict'

const Database = require('better-sqlite3')
const { _insertDeliveries: insertDeliveries } = require('./index')

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE players (
      player_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      team TEXT
    );
    CREATE TABLE innings (
      result_id INTEGER PRIMARY KEY,
      fixture_id TEXT NOT NULL,
      innings_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id INTEGER NOT NULL,
      innings_number INTEGER NOT NULL,
      over_no INTEGER NOT NULL,
      ball_no INTEGER NOT NULL,
      ball_no_disp INTEGER,
      batter_id INTEGER NOT NULL,
      batter_id_ns INTEGER,
      bowler_id INTEGER NOT NULL,
      dismissed_batter_id INTEGER,
      runs_bat INTEGER NOT NULL DEFAULT 0,
      runs_extra INTEGER NOT NULL DEFAULT 0,
      extras_type INTEGER,
      l_desc TEXT,
      s_desc TEXT,
      last_update_time TEXT,
      UNIQUE(result_id, innings_number, over_no, ball_no, ball_no_disp)
    );
  `)
  return db
}

// Build a minimal 'inn' object for insertDeliveries.
function makeInn({ batting, bowlerId, bowlerName, fallOfWickets = [], overs }) {
  return {
    batting_team: 'TestTeam',
    batting,
    bowling: [{ name: bowlerName, player_id: bowlerId }],
    fallOfWickets,
    overs: overs.map((balls, i) => ({
      over_no: i + 1,
      bowlers: [bowlerName],
      balls: balls.map((t) => {
        if (t === '.') return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false }
        if (t === 'W') return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: true }
        if (typeof t === 'number')
          return { runs_bat: t, runs_extra: 0, extras_type: null, is_wicket: false }
        return t
      })
    }))
  }
}

function batterBalls(db, resultId, batterId) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM deliveries WHERE result_id=? AND batter_id=?')
    .get(resultId, batterId).c
}

describe('insertDeliveries — retirement fallback (no R token)', () => {
  let db, bowlerMap, resultId

  beforeEach(() => {
    db = makeDb()
    // Players: opener A (id=1), opener B (id=2), next batter C (id=3), bowler (id=9)
    db.prepare("INSERT INTO players VALUES (1,'Opener A',null,'T')").run()
    db.prepare("INSERT INTO players VALUES (2,'Opener B',null,'T')").run()
    db.prepare("INSERT INTO players VALUES (3,'Next Batter',null,'T')").run()
    db.prepare("INSERT INTO players VALUES (9,'Bowler',null,'Opp')").run()
    db.prepare("INSERT INTO innings VALUES (99,'fx1',1)").run()
    resultId = 99
    bowlerMap = { bowler: 9 }
  })

  it('retires opener A after their run threshold and attributes subsequent balls to next batter', () => {
    // A retires after scoring 4 runs. Over 1: A scores 2,2 then retires; C comes in.
    // Even runs so A stays on strike until retired.
    // Over 1: A(2), A(2) → A reaches 4 → C replaces A. C(.), C(.), C(.), C(.)
    // End of over swap: B becomes striker.
    // Over 2: B faces 6 dots.
    const batting = [
      { name: 'Opener A', player_id: 1, how_out: 'retired', runs: 4, balls: 2, not_out: true },
      { name: 'Opener B', player_id: 2, how_out: 'not out', runs: 0, balls: 6, not_out: true },
      { name: 'Next Batter', player_id: 3, how_out: 'not out', runs: 0, balls: 4, not_out: true }
    ]

    const inn = makeInn({
      batting,
      bowlerId: 9,
      bowlerName: 'Bowler',
      overs: [
        [2, 2, '.', '.', '.', '.'], // A scores 4, retires → C gets balls 3-6
        ['.', '.', '.', '.', '.', '.'] // B bats over 2 after end-of-over swap
      ]
    })

    insertDeliveries(db, resultId, 1, inn, bowlerMap)

    expect(batterBalls(db, resultId, 1)).toBe(2) // A: only 2 balls before retiring
    expect(batterBalls(db, resultId, 3)).toBe(4) // C: 4 balls after A retires
    expect(batterBalls(db, resultId, 2)).toBe(6) // B: full over 2
  })

  it('does not re-fire retirement when R token is already present', () => {
    // The explicit 'R' token fires; fallback should not double-retire.
    const batting = [
      { name: 'Opener A', player_id: 1, how_out: 'retired', runs: 4, balls: 2, not_out: true },
      { name: 'Opener B', player_id: 2, how_out: 'not out', runs: 0, balls: 6, not_out: true },
      { name: 'Next Batter', player_id: 3, how_out: 'not out', runs: 0, balls: 4, not_out: true }
    ]

    const R = { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false, retired: true }
    const inn = makeInn({
      batting,
      bowlerId: 9,
      bowlerName: 'Bowler',
      overs: [
        [2, R, '.', '.', '.', '.'], // A scores 2, then R token fires — C comes in
        ['.', '.', '.', '.', '.', '.']
      ]
    })

    insertDeliveries(db, resultId, 1, inn, bowlerMap)

    // A should have exactly 2 balls (scored 2, then retired via R token on next ball)
    expect(batterBalls(db, resultId, 1)).toBe(2)
    // C should get some balls after A retires
    expect(batterBalls(db, resultId, 3)).toBeGreaterThan(0)
  })
})
