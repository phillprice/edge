'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { parseHowOut, getPartnerships, buildMatchFlow, isWhccTeam, getFormatConfig, parseCatcher } =
  require('./matches')._test

// ─── Seed DB once ─────────────────────────────────────────────────────────────

beforeAll(() => {
  seed(process.env.DB_PATH)
})

// ─── isWhccTeam ────────────────────────────────────────────────────────────────

describe('isWhccTeam', () => {
  it('matches "woking"', () => expect(isWhccTeam('Woking & Horsell CC')).toBe(true))
  it('matches "horsell"', () => expect(isWhccTeam('Horsell CC')).toBe(true))
  it('matches "whcc"', () => expect(isWhccTeam('WHCC Whirlwinds')).toBe(true))
  it('does NOT match hurricane (used by other clubs)', () =>
    expect(isWhccTeam('Hurricane XI')).toBe(false))
  it('does NOT match whirlwind (used by other clubs)', () =>
    expect(isWhccTeam('Whirlwind CC')).toBe(false))
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
    db.prepare(
      `
      INSERT INTO deliveries (result_id, innings_number, over_no, ball_no,
        batter_id, batter_id_ns, bowler_id, runs_bat)
      VALUES (1001, 1, 99, 1, 103, 103, 301, 4)
    `
    ).run()
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
    over_no: 0,
    ball_no: 1,
    ball_no_disp: null,
    batter_id: 1,
    batter_name: 'Alice',
    bowler_id: 10,
    bowler_name: 'Bob',
    runs_bat: 0,
    runs_extra: 0,
    extras_type: null,
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

  it('team milestone fires at 50 (WHCC batting)', () => {
    const dels = []
    for (let i = 0; i < 10; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 5 }))
    const events = buildMatchFlow(dels, false, 0, {}, [], [], true)
    const milestone = events.find((e) => e.type === 'team_milestone' && e.runs === 50)
    expect(milestone).toBeDefined()
    expect(milestone.wickets).toBe(0)
  })

  it('batter milestone fires when reaching 15 runs (WHCC batting)', () => {
    const dels = []
    for (let i = 0; i < 5; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 3 }))
    const events = buildMatchFlow(dels, false, 0, {}, [], [], true)
    const m = events.find((e) => e.type === 'batter_milestone' && e.runs === 15)
    expect(m).toBeDefined()
    expect(m.player).toBe('Alice')
  })

  it('suppresses opposition run/batter milestones when WHCC is bowling', () => {
    const dels = []
    for (let i = 0; i < 10; i++)
      dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 5, batter_id: 1 }))
    const events = buildMatchFlow(dels, false, 0, {}, [], [], false)
    expect(events.some((e) => e.type === 'team_milestone')).toBe(false)
    expect(events.some((e) => e.type === 'batter_milestone')).toBe(false)
  })

  it('fires wicket event with partnership runs', () => {
    const dels = [
      mkDelivery({ ball_no: 1, runs_bat: 10 }),
      mkDelivery({ ball_no: 2, runs_bat: 0, dismissed_batter_id: 1 }),
    ]
    const events = buildMatchFlow(dels, false, 0, {}, [])
    const wkt = events.find((e) => e.type === 'wicket')
    expect(wkt).toBeDefined()
    expect(wkt.partnership).toBe(10)
    expect(wkt.player).toBe('Alice')
  })

  it('fires bowler_haul at 3rd wicket when NOT whcc batting', () => {
    const dels = []
    for (let i = 0; i < 3; i++) {
      dels.push(
        mkDelivery({
          ball_no: i * 2 + 1,
          runs_bat: 2,
          batter_id: 100 + i,
          batter_name: `Batter${i}`,
        })
      )
      dels.push(
        mkDelivery({
          ball_no: i * 2 + 2,
          runs_bat: 0,
          batter_id: 100 + i,
          dismissed_batter_id: 100 + i,
        })
      )
    }
    const events = buildMatchFlow(dels, false, 0, {}, {}, [], false)
    const haul = events.find((e) => e.type === 'bowler_haul')
    expect(haul).toBeDefined()
    expect(haul.wickets).toBe(3)
    expect(haul.player).toBe('Bob')
  })

  it('suppresses bowler_haul when isWhccBatting = true', () => {
    const dels = []
    for (let i = 0; i < 3; i++) {
      dels.push(
        mkDelivery({
          ball_no: i * 2 + 1,
          runs_bat: 2,
          batter_id: 100 + i,
          batter_name: `Batter${i}`,
        })
      )
      dels.push(
        mkDelivery({
          ball_no: i * 2 + 2,
          runs_bat: 0,
          batter_id: 100 + i,
          dismissed_batter_id: 100 + i,
        })
      )
    }
    const events = buildMatchFlow(dels, false, 0, {}, {}, [], true)
    expect(events.find((e) => e.type === 'bowler_haul')).toBeUndefined()
    // wicket events should still fire
    expect(events.filter((e) => e.type === 'wicket').length).toBe(3)
  })

  // ── maidens ──────────────────────────────────────────────────────────────
  const maidenOver = (extra = {}) => [
    ...[1, 2, 3, 4, 5].map((b) => mkDelivery({ over_no: 0, ball_no: b })),
    mkDelivery({ over_no: 0, ball_no: 6, ...extra }),
  ]

  it('emits a maiden for a 6-ball wicketless over when WHCC bowling', () => {
    const events = buildMatchFlow(maidenOver(), false, 0, {}, {}, [], false)
    expect(events.filter((e) => e.type === 'maiden').length).toBe(1)
  })

  it('byes and leg-byes do NOT break a maiden (not charged to the bowler)', () => {
    // 5 dots + a 2-run bye (extras_type 3) — still 6 legal balls, 0 bowler runs
    expect(
      buildMatchFlow(
        maidenOver({ extras_type: 3, runs_extra: 2 }),
        false,
        0,
        {},
        {},
        [],
        false
      ).some((e) => e.type === 'maiden')
    ).toBe(true)
    expect(
      buildMatchFlow(
        maidenOver({ extras_type: 4, runs_extra: 1 }),
        false,
        0,
        {},
        {},
        [],
        false
      ).some((e) => e.type === 'maiden')
    ).toBe(true)
  })

  it('a wide breaks a maiden (charged to the bowler)', () => {
    // 6 dots (legal) + an extra wide delivery conceding 1
    const dels = [
      ...maidenOver(),
      mkDelivery({ over_no: 0, ball_no: 7, extras_type: 2, runs_extra: 1 }),
    ]
    expect(buildMatchFlow(dels, false, 0, {}, {}, [], false).some((e) => e.type === 'maiden')).toBe(
      false
    )
  })

  it('classifies a two-wicket maiden as double_wicket_maiden', () => {
    const dels = maidenOver()
    dels[2].dismissed_batter_id = dels[2].batter_id
    dels[4].dismissed_batter_id = dels[4].batter_id
    const events = buildMatchFlow(dels, false, 0, {}, {}, [], false)
    expect(events.some((e) => e.type === 'double_wicket_maiden')).toBe(true)
    expect(events.some((e) => e.type === 'maiden' || e.type === 'wicket_maiden')).toBe(false)
  })

  it('suppresses maidens when WHCC is batting (opposition bowling)', () => {
    const events = buildMatchFlow(maidenOver(), false, 0, {}, {}, [], true)
    expect(events.some((e) => /maiden/.test(e.type))).toBe(false)
  })

  it('fires pairs_out instead of wicket in pairs format', () => {
    const dels = [mkDelivery({ ball_no: 1, runs_bat: 0, dismissed_batter_id: 1 })]
    const events = buildMatchFlow(dels, true, 200, {}, [])
    expect(events.find((e) => e.type === 'pairs_out')).toBeDefined()
    expect(events.find((e) => e.type === 'wicket')).toBeUndefined()
  })

  it('innings_end includes netScore in pairs format', () => {
    const dels = [mkDelivery({ ball_no: 1, runs_bat: 30 })]
    const events = buildMatchFlow(dels, true, 200, {}, [])
    const end = events.find((e) => e.type === 'innings_end')
    expect(end.netScore).toBeDefined()
    expect(end.netScore).toBe(200 + 30 - 0 * 5) // no wickets
  })

  it('keeper_change event injected at correct over', () => {
    const dels = [mkDelivery({ over_no: 0, ball_no: 1 }), mkDelivery({ over_no: 1, ball_no: 1 })]
    const wkAssignments = [{ from_over: 2, keeper_name: 'New Keeper' }]
    const events = buildMatchFlow(dels, false, 0, {}, {}, wkAssignments)
    expect(events.find((e) => e.type === 'keeper_change')).toBeDefined()
    expect(events.find((e) => e.type === 'keeper_change').player).toBe('New Keeper')
  })

  it('T20 batter milestones fire at 15/20/25/30', () => {
    const dels = []
    for (let i = 0; i < 10; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 3 })) // 30 runs
    const events = buildMatchFlow(dels, false, 0, {}, {}, [], true, 20)
    const milestoneRuns = events.filter((e) => e.type === 'batter_milestone').map((e) => e.runs)
    expect(milestoneRuns).toContain(15)
    expect(milestoneRuns).toContain(30)
    expect(milestoneRuns).not.toContain(50)
  })

  it('50-over batter milestones fire at 25/50/75/100', () => {
    const dels = []
    for (let i = 0; i < 17; i++) dels.push(mkDelivery({ ball_no: i + 1, runs_bat: 3 })) // 51 runs
    const events = buildMatchFlow(dels, false, 0, {}, {}, [], true, 50)
    const milestoneRuns = events.filter((e) => e.type === 'batter_milestone').map((e) => e.runs)
    expect(milestoneRuns).toContain(25)
    expect(milestoneRuns).toContain(50)
    expect(milestoneRuns).not.toContain(15)
  })

  // ── bowling milestone ("N down for R") ──────────────────────────────────────
  // Team size is derived from the batters who appear in the innings, so fixtures
  // include the full side (one delivery per batter; the first N are dismissed).
  const bowlingInnings = (teamSize, wickets, runsEach = 0) =>
    Array.from({ length: teamSize }, (_, i) =>
      mkDelivery({
        over_no: i,
        ball_no: 1,
        runs_bat: runsEach,
        batter_id: 10 + i,
        dismissed_batter_id: i < wickets ? 10 + i : null,
      })
    )

  it('fires a bowling_milestone at half the side down (team of 11 → 5)', () => {
    const events = buildMatchFlow(bowlingInnings(11, 6, 7), false, 0, {}, {}, [], false, 20)
    const ms = events.filter((e) => e.type === 'bowling_milestone')
    expect(ms.length).toBe(1)
    expect(ms[0].wickets).toBe(5) // floor(11/2)
    expect(ms[0].runs).toBe(35) // 5 batters out × 7 by the 5th wicket
  })

  it('bowling_milestone threshold tracks team size (8 → 4)', () => {
    const events = buildMatchFlow(bowlingInnings(8, 5), false, 0, {}, {}, [], false, 20)
    const ms = events.filter((e) => e.type === 'bowling_milestone')
    expect(ms.length).toBe(1)
    expect(ms[0].wickets).toBe(4) // floor(8/2)
  })

  it('no bowling_milestone when WHCC is batting', () => {
    const events = buildMatchFlow(bowlingInnings(11, 6), false, 0, {}, {}, [], true, 20)
    expect(events.some((e) => e.type === 'bowling_milestone')).toBe(false)
  })

  it('pairs: bowling_milestone every 4 dismissals', () => {
    const events = buildMatchFlow(bowlingInnings(12, 9), true, 200, {}, {}, [], false, 20)
    const ms = events.filter((e) => e.type === 'bowling_milestone')
    expect(ms.map((m) => m.wickets)).toEqual([4, 8])
  })
})

// ─── getFormatConfig ───────────────────────────────────────────────────────────

describe('getFormatConfig', () => {
  it('T20 (20 overs) returns T20 config with 6-over powerplay', () => {
    const cfg = getFormatConfig(20)
    expect(cfg.name).toBe('T20')
    expect(cfg.phaseBoundaries[0]).toMatchObject({ phase: 'Powerplay', from: 1, to: 6 })
    expect(cfg.batterMilestones).toContain(15)
    expect(cfg.batterMilestones).not.toContain(50)
  })

  it('30-over returns correct phase boundaries', () => {
    const cfg = getFormatConfig(30)
    expect(cfg.name).toBe('30-over')
    expect(cfg.phaseBoundaries[2]).toMatchObject({ phase: 'Death', from: 25, to: 30 })
    expect(cfg.batterMilestones).toContain(50)
  })

  it('40-over returns correct phase boundaries', () => {
    const cfg = getFormatConfig(40)
    expect(cfg.name).toBe('40-over')
    expect(cfg.phaseBoundaries[0]).toMatchObject({ phase: 'Powerplay', from: 1, to: 8 })
    expect(cfg.batterMilestones).toContain(100)
  })

  it('50-over returns correct phase boundaries and higher wicket value', () => {
    const cfg = getFormatConfig(50)
    expect(cfg.name).toBe('50-over')
    expect(cfg.phaseBoundaries[0]).toMatchObject({ phase: 'Powerplay', from: 1, to: 10 })
    expect(cfg.wicketVal).toBe(2.5)
  })

  it('null/undefined defaults to T20', () => {
    expect(getFormatConfig(null).name).toBe('T20')
    expect(getFormatConfig(undefined).name).toBe('T20')
  })
})

// ─── parseCatcher ──────────────────────────────────────────────────────────────

describe('parseCatcher', () => {
  it('extracts catcher name from ct X b Y format', () => {
    expect(parseCatcher('ct Zayd Akhtar b Sebastian Mills')).toBe('Zayd Akhtar')
  })
  it('handles single-name catcher', () => {
    expect(parseCatcher('ct Jones b Smith')).toBe('Jones')
  })
  it('c&b returns bowler as catcher', () => {
    expect(parseCatcher('c&b Mills')).toBe('Mills')
  })
  it('caught and bowled returns bowler as catcher', () => {
    expect(parseCatcher('caught and bowled Sebastian Mills')).toBe('Sebastian Mills')
  })
  it('ct and b returns bowler as catcher', () => {
    expect(parseCatcher('ct and b Smith')).toBe('Smith')
  })
  it('returns null for no catch', () => {
    expect(parseCatcher('Bowled Smith')).toBeNull()
    expect(parseCatcher('LBW b Smith')).toBeNull()
    expect(parseCatcher(null)).toBeNull()
  })
})
