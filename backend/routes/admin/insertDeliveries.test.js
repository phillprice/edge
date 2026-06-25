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
// openers: [{ id, name, balls?, retired? }]  — first two are openers
// nextBatter: { id, name }                   — comes in after first opener retires
// overs: array of ball-token arrays (one per over)
// bowlerId must be pre-inserted as a player.
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

function batterRuns(db, resultId, batterId) {
  return db
    .prepare(
      'SELECT COALESCE(SUM(runs_bat),0) AS r FROM deliveries WHERE result_id=? AND batter_id=?'
    )
    .get(resultId, batterId).r
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

  it('retires opener A after their ball count and attributes subsequent balls to next batter', () => {
    // Opener A retires after 3 balls; Opener B is non-striker throughout.
    // Over 1: A faces balls 1,3,5 (dots on odd positions after cross); B faces 2,4,6
    // After A's 3rd ball, C should come in for A.
    const batting = [
      { name: 'Opener A', player_id: 1, how_out: 'retired', balls: 3, not_out: true },
      { name: 'Opener B', player_id: 2, how_out: 'not out', balls: 6, not_out: true },
      { name: 'Next Batter', player_id: 3, how_out: 'not out', balls: 3, not_out: true }
    ]

    // Two overs: A and B bat alternating (all dots — no crossing).
    // A faces balls 1,3,5 of over 1 = 3 balls → retires after ball 5.
    // B faces balls 2,4,6 of over 1 and then (after end-of-over swap) 1,3,5 of over 2.
    // C should face balls 1 onwards of over 2 at A's end (non-striker after swap).
    // Let's verify C gets credit for any balls after A retires.
    const inn = makeInn({
      batting,
      bowlerId: 9,
      bowlerName: 'Bowler',
      overs: [
        ['.', '.', '.', '.', '.', '.'], // over 1: A,B,A,B,A,B — A faces 3, B faces 3
        ['.', '.', '.', '.', '.', '.'] // over 2: B,?,B,?,B,? — A retired → C in
      ]
    })

    insertDeliveries(db, resultId, 1, inn, bowlerMap)

    // A should have exactly 3 balls (not 6)
    expect(batterBalls(db, resultId, 1)).toBe(3)
    // C should have 3 balls (the 3 balls A would otherwise have faced in over 2)
    expect(batterBalls(db, resultId, 3)).toBe(3)
    // B should have 6 balls total
    expect(batterBalls(db, resultId, 2)).toBe(6)
  })

  it('does not re-fire retirement when R token is already present', () => {
    // The 'R' token fires at ball 3; fallback should not double-retire.
    const batting = [
      { name: 'Opener A', player_id: 1, how_out: 'retired', balls: 3, not_out: true },
      { name: 'Opener B', player_id: 2, how_out: 'not out', balls: 6, not_out: true },
      { name: 'Next Batter', player_id: 3, how_out: 'not out', balls: 3, not_out: true }
    ]

    const R = { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false, retired: true }
    const inn = makeInn({
      batting,
      bowlerId: 9,
      bowlerName: 'Bowler',
      overs: [
        ['.', '.', R, '.', '.', '.'], // A retires on ball 3 via R token
        ['.', '.', '.', '.', '.', '.']
      ]
    })

    insertDeliveries(db, resultId, 1, inn, bowlerMap)

    // A should have exactly 3 balls (R token + 2 prior; R itself is ball 3)
    // After R, C comes in — C should get the remaining striker balls
    expect(batterBalls(db, resultId, 1)).toBe(3)
    expect(batterBalls(db, resultId, 3)).toBeGreaterThan(0)
  })
})
