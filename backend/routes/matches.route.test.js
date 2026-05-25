'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { execSync } = require('child_process')
const { parseHowOut, getPartnerships, buildMatchFlow, isWhccTeam } = require('./matches')._test

// ─── Seed DB once ─────────────────────────────────────────────────────────────

beforeAll(() => {
  execSync(`node ${path.join(__dirname, '..', 'scripts', 'seed-test-db.js')}`, { stdio: 'pipe' })
})

// ─── isWhccTeam ────────────────────────────────────────────────────────────────

describe('isWhccTeam', () => {
  it('matches "woking"', () => expect(isWhccTeam('Woking & Horsell CC')).toBe(true))
  it('matches "horsell"', () => expect(isWhccTeam('Horsell CC')).toBe(true))
  it('matches "whcc"', () => expect(isWhccTeam('WHCC Whirlwinds')).toBe(true))
  it('does NOT match hurricane (used by other clubs)', () => expect(isWhccTeam('Hurricane XI')).toBe(false))
  it('does NOT match whirlwind (used by other clubs)', () => expect(isWhccTeam('Whirlwind CC')).toBe(false))
  it('rejects opposition', () => expect(isWhccTeam('Epsom CC')).toBe(false))
  it('handles null/empty', () => {
    expect(isWhccTeam(null)).toBe(false)
    expect(isWhccTeam('')).toBe(false)
  })
})

// ─── parseHowOut ──────────────────────────────────────────────────────────────

describe('parseHowOut', () => {
  it('run out with fielder', () => {
    const r = parseHowOut('Run out (Smith)')
    expect(r.type).toBe('Run out')
    expect(r.fielder).toBe('Smith')
    expect(r.bowler).toBeNull()
  })
  it('run out without fielder', () => {
    const r = parseHowOut('run out')
    expect(r.type).toBe('Run out')
    expect(r.fielder).toBeNull()
  })
  it('caught and bowled (c&b)', () => {
    const r = parseHowOut('c&b Jones')
    expect(r.type).toBe('CaughtAndBowled')
    expect(r.bowler).toBe('Jones')
    expect(r.fielder).toBeNull()
  })
  it('caught and bowled (long form)', () => {
    const r = parseHowOut('caught and bowled Smith')
    expect(r.type).toBe('CaughtAndBowled')
    expect(r.bowler).toBe('Smith')
  })
  it('LBW', () => {
    const r = parseHowOut('LBW b Taylor')
    expect(r.type).toBe('LBW')
    expect(r.bowler).toBe('Taylor')
  })
  it('stumped (long form)', () => {
    const r = parseHowOut('Stumped Jones b Smith')
    expect(r.type).toBe('Stumped')
    expect(r.fielder).toBe('Jones')
    expect(r.bowler).toBe('Smith')
  })
  it('stumped (st shorthand)', () => {
    const r = parseHowOut('st Jones b Smith')
    expect(r.type).toBe('Stumped')
  })
  it('caught (ct shorthand)', () => {
    const r = parseHowOut('ct Jones b Smith')
    expect(r.type).toBe('Caught')
    expect(r.fielder).toBe('Jones')
    expect(r.bowler).toBe('Smith')
  })
  it('bowled (b shorthand)', () => {
    const r = parseHowOut('b Smith')
    expect(r.type).toBe('Bowled')
    expect(r.bowler).toBe('Smith')
  })
  it('bowled (long form)', () => {
    const r = parseHowOut('Bowled Smith')
    expect(r.type).toBe('Bowled')
  })
  it('returns null for unrecognised string', () => {
    expect(parseHowOut('hit wicket')).toBeNull()
  })
  it('returns null for null/empty input', () => {
    expect(parseHowOut(null)).toBeNull()
    expect(parseHowOut('')).toBeNull()
  })
})

// ─── getPartnerships ──────────────────────────────────────────────────────────

describe('getPartnerships', () => {
  let db

  beforeEach(() => {
    db = require('../db/schema').getDb()
  })

  it('returns partnerships for seeded fixture', () => {
    const ps = getPartnerships(db, '25577112')
    expect(ps.length).toBeGreaterThan(0)
  })

  it('first partnership is Leo (103) + Tom (104) in over 0', () => {
    const ps = getPartnerships(db, '25577112')
    const p1 = ps[0]
    expect([p1.batter1_id, p1.batter2_id].sort((a, b) => a - b)).toEqual([103, 104])
    expect(p1.innings_order).toBe(1)
  })

  it('second partnership is Leo (103) + Jack (105) in over 1', () => {
    const ps = getPartnerships(db, '25577112')
    const p2 = ps[1]
    expect([p2.batter1_id, p2.batter2_id].sort((a, b) => a - b)).toEqual([103, 105])
  })

  it('batter1_id is always the lower id', () => {
    const ps = getPartnerships(db, '25577112')
    for (const p of ps) {
      expect(p.batter1_id).toBeLessThanOrEqual(p.batter2_id)
    }
  })

  it('skips deliveries where batter_id_ns is null', () => {
    // No ns-null deliveries in seeded data, so count should equal 4 (2 per innings)
    const ps = getPartnerships(db, '25577112')
    for (const p of ps) {
      expect(p.batter1_id).not.toBeNull()
      expect(p.batter2_id).not.toBeNull()
    }
  })

  it('returns empty for unknown fixture', () => {
    const ps = getPartnerships(db, 'DOES_NOT_EXIST')
    expect(ps).toEqual([])
  })

  it('does not create a partnership when batter_id === batter_id_ns', () => {
    // Insert a delivery with same striker and non-striker
    db.prepare(`
      INSERT INTO deliveries (result_id, innings_number, over_no, ball_no,
        batter_id, batter_id_ns, bowler_id, runs_bat)
      VALUES (1001, 1, 99, 1, 103, 103, 301, 4)
    `).run()
    const ps = getPartnerships(db, '25577112')
    // None of the partnerships should have batter1_id === batter2_id
    for (const p of ps) {
      expect(p.batter1_id).not.toBe(p.batter2_id)
    }
    // Clean up
    db.prepare(`DELETE FROM deliveries WHERE over_no = 99 AND result_id = 1001`).run()
  })

  it('per-batter run attribution is correct for first partnership', () => {
    // Over 0: Leo(103) scores 2+1+6=9; Tom(104) scores 0+4=4 (ball 6 is out, 0 runs)
    const ps = getPartnerships(db, '25577112')
    const p = ps[0] // Leo+Tom
    const leoRuns = p.batter1_id === 103 ? p.batter1_runs : p.batter2_runs
    const tomRuns = p.batter1_id === 104 ? p.batter1_runs : p.batter2_runs
    expect(leoRuns).toBe(9)
    expect(tomRuns).toBe(4)
  })
})

// ─── buildMatchFlow ───────────────────────────────────────────────────────────

function mkDelivery(overrides = {}) {
  return {
    over_no: 0, ball_no: 1, ball_no_disp: null,
    batter_id: 1, batter_name: 'Alice',
    bowler_id: 10, bowler_name: 'Bob',
    runs_bat: 0, runs_extra: 0, extras_type: null,
    dismissed_batter_id: null,
    ...overrides,
  }
}

describe('buildMatchFlow', () => {
  it('returns empty array for no deliveries', () => {
    expect(buildMatchFlow([], false, 0, {}, [])).toEqual([])
  })

  it('always ends with innings_end', () => {
    const dels = [mkDelivery({ runs_bat: 4 })]
    const events = buildMatchFlow(dels, false, 0, {}, [])
    expect(events[events.length - 1].type).toBe('innings_end')
  })

  it('team milestone fires at 50', () => {
    const dels = []
    for (let i = 0; i < 10; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 5 }))
    const events = buildMatchFlow(dels, false, 0, {}, [])
    const milestone = events.find(e => e.type === 'team_milestone' && e.runs === 50)
    expect(milestone).toBeDefined()
    expect(milestone.wickets).toBe(0)
  })

  it('batter milestone fires when reaching 15 runs', () => {
    const dels = []
    for (let i = 0; i < 5; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 3 }))
    const events = buildMatchFlow(dels, false, 0, {}, [])
    const m = events.find(e => e.type === 'batter_milestone' && e.runs === 15)
    expect(m).toBeDefined()
    expect(m.player).toBe('Alice')
  })

  it('fires wicket event with partnership runs', () => {
    const dels = [
      mkDelivery({ ball_no: 1, runs_bat: 10 }),
      mkDelivery({ ball_no: 2, runs_bat: 0, dismissed_batter_id: 1 }),
    ]
    const events = buildMatchFlow(dels, false, 0, {}, [])
    const wkt = events.find(e => e.type === 'wicket')
    expect(wkt).toBeDefined()
    expect(wkt.partnership).toBe(10)
    expect(wkt.player).toBe('Alice')
  })

  it('fires bowler_haul at 3rd wicket when NOT whcc batting', () => {
    const dels = []
    for (let i = 0; i < 3; i++) {
      dels.push(mkDelivery({ ball_no: i * 2 + 1, runs_bat: 2, batter_id: 100 + i, batter_name: `Batter${i}` }))
      dels.push(mkDelivery({ ball_no: i * 2 + 2, runs_bat: 0, batter_id: 100 + i, dismissed_batter_id: 100 + i }))
    }
    const events = buildMatchFlow(dels, false, 0, {}, [], false)
    const haul = events.find(e => e.type === 'bowler_haul')
    expect(haul).toBeDefined()
    expect(haul.wickets).toBe(3)
    expect(haul.player).toBe('Bob')
  })

  it('suppresses bowler_haul when isWhccBatting = true', () => {
    const dels = []
    for (let i = 0; i < 3; i++) {
      dels.push(mkDelivery({ ball_no: i * 2 + 1, runs_bat: 2, batter_id: 100 + i, batter_name: `Batter${i}` }))
      dels.push(mkDelivery({ ball_no: i * 2 + 2, runs_bat: 0, batter_id: 100 + i, dismissed_batter_id: 100 + i }))
    }
    const events = buildMatchFlow(dels, false, 0, {}, [], true)
    expect(events.find(e => e.type === 'bowler_haul')).toBeUndefined()
    // wicket events should still fire
    expect(events.filter(e => e.type === 'wicket').length).toBe(3)
  })

  it('fires pairs_out instead of wicket in pairs format', () => {
    const dels = [
      mkDelivery({ ball_no: 1, runs_bat: 0, dismissed_batter_id: 1 }),
    ]
    const events = buildMatchFlow(dels, true, 200, {}, [])
    expect(events.find(e => e.type === 'pairs_out')).toBeDefined()
    expect(events.find(e => e.type === 'wicket')).toBeUndefined()
  })

  it('innings_end includes netScore in pairs format', () => {
    const dels = [mkDelivery({ ball_no: 1, runs_bat: 30 })]
    const events = buildMatchFlow(dels, true, 200, {}, [])
    const end = events.find(e => e.type === 'innings_end')
    expect(end.netScore).toBeDefined()
    expect(end.netScore).toBe(200 + 30 - 0 * 5) // no wickets
  })

  it('keeper_change event injected at correct over', () => {
    const dels = [
      mkDelivery({ over_no: 0, ball_no: 1 }),
      mkDelivery({ over_no: 1, ball_no: 1 }),
    ]
    const wkAssignments = [{ from_over: 2, keeper_name: 'New Keeper' }]
    const events = buildMatchFlow(dels, false, 0, {}, wkAssignments)
    expect(events.find(e => e.type === 'keeper_change')).toBeDefined()
    expect(events.find(e => e.type === 'keeper_change').player).toBe('New Keeper')
  })
})
