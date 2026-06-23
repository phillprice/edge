'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
delete process.env.CLERK_SECRET_KEY

const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')
const { buildTestApp } = require('./test-helpers')

const matchesRouter = require('./matches/index')
const manualRouter = require('./manual')

function buildMatchApp() {
  return buildTestApp('/api/matches', matchesRouter)
}

function buildManualApp() {
  return buildTestApp('/api/manual', manualRouter)
}

let matchApp, manualApp, db

beforeAll(() => {
  seed(process.env.DB_PATH)
  db = require('../db/schema').getDb()
  matchApp = buildMatchApp()
  manualApp = buildManualApp()
})

afterAll(() => {
  db.prepare(`DELETE FROM dismissals WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM wk_errors WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM wk_assignments WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM match_captains WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(
    `DELETE FROM deliveries WHERE result_id IN (SELECT result_id FROM innings WHERE fixture_id LIKE 'manual-%')`
  ).run()
  db.prepare(`DELETE FROM innings WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_fielding WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_bowling WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_batting WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM manual_extras WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM mvp_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM match_stats_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM fixture_seasons WHERE fixture_id LIKE 'manual-%'`).run()
  db.prepare(`DELETE FROM fixtures WHERE fixture_id LIKE 'manual-%'`).run()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createFixture(extra = {}) {
  const res = await request(manualApp)
    .post('/api/manual/fixture')
    .send({ match_date: '2026-07-01', home_team: 'WHCC A', away_team: 'Opp CC', ...extra })
  if (res.status !== 200) throw new Error(`createFixture failed: ${JSON.stringify(res.body)}`)
  return res.body.fixture_id
}

async function ensureInnings(fixtureId, order = 1) {
  const res = await request(matchApp)
    .post(`/api/matches/${fixtureId}/innings`)
    .send({ innings_order: order })
  if (res.status !== 200) throw new Error(`ensureInnings failed: ${JSON.stringify(res.body)}`)
  return res.body
}

// Post N identical dot-ball deliveries; returns array of response bodies
async function postBalls(fixtureId, order, count, extra = {}) {
  const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
  const results = []
  for (let i = 0; i < count; i++) {
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/${order}/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 0, ...extra })
    if (res.status !== 200)
      throw new Error(`postBalls failed on ball ${i + 1}: ${JSON.stringify(res.body)}`)
    results.push(res.body)
  }
  return results
}

// ─── Standard 6-ball over (regression) ───────────────────────────────────────

describe('delivery: standard 6-ball over', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture()
  })

  it('first 6 deliveries stay in over 0', async () => {
    await ensureInnings(fixtureId, 1)
    const balls = await postBalls(fixtureId, 1, 6)
    expect(balls.every((b) => b.over_no === 0)).toBe(true)
  })

  it('7th delivery starts over 1', async () => {
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: 1, bowler_id: 1, runs_bat: 0 })
    expect(res.status).toBe(200)
    expect(res.body.over_no).toBe(1)
  })
})

// ─── Custom balls-per-over ─────────────────────────────────────────────────────

describe('delivery: balls_per_over=8', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture({ balls_per_over: 8 })
    await ensureInnings(fixtureId, 1)
  })

  it('first 8 deliveries stay in over 0', async () => {
    const balls = await postBalls(fixtureId, 1, 8)
    expect(balls.every((b) => b.over_no === 0)).toBe(true)
  })

  it('9th delivery starts over 1', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0 })
    expect(res.status).toBe(200)
    expect(res.body.over_no).toBe(1)
  })
})

// ─── no_ball_rebowl='never' — no-ball counts as a legal delivery ───────────────

describe('delivery: no_ball_rebowl=never', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture({ no_ball_rebowl: 'never' })
    await ensureInnings(fixtureId, 1)
  })

  it('6 deliveries including a no-ball end the over', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    // 5 normal + 1 no-ball = 6 "legal" balls when rebowl=never
    await postBalls(fixtureId, 1, 5)
    const noBallRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 1, extras_type: 1 })
    expect(noBallRes.status).toBe(200)
    expect(noBallRes.body.over_no).toBe(0)

    // Next ball should be in over 1
    const nextRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0 })
    expect(nextRes.status).toBe(200)
    expect(nextRes.body.over_no).toBe(1)
  })
})

// ─── wide_rebowl='never' — wide counts as a legal delivery ────────────────────

describe('delivery: wide_rebowl=never', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture({ wide_rebowl: 'never' })
    await ensureInnings(fixtureId, 1)
  })

  it('6 deliveries including a wide end the over', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    await postBalls(fixtureId, 1, 5)
    const wideRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 1, extras_type: 2 })
    expect(wideRes.status).toBe(200)
    expect(wideRes.body.over_no).toBe(0)

    const nextRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0 })
    expect(nextRes.status).toBe(200)
    expect(nextRes.body.over_no).toBe(1)
  })
})

// ─── Penalty runs (extras_type=5) ─────────────────────────────────────────────

describe('delivery: penalty runs (extras_type=5)', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
  })

  it('penalty delivery is accepted and does not advance the over', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    const overBefore =
      db
        .prepare(
          `SELECT MAX(over_no) AS ov FROM deliveries
         WHERE result_id = (SELECT result_id FROM innings WHERE fixture_id = ? AND innings_order = 1)`
        )
        .get(fixtureId)?.ov ?? -1

    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 5, extras_type: 5 })
    expect(res.status).toBe(200)
    expect(res.body.over_no).toBe(Math.max(overBefore, 0))
  })

  it('penalty of 5 appears in the over history with correct runs', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 5, extras_type: 5 })
    expect(res.status).toBe(200)

    const row = db
      .prepare(`SELECT runs_extra, extras_type FROM deliveries WHERE id = ?`)
      .get(res.body.id)
    expect(row.extras_type).toBe(5)
    expect(row.runs_extra).toBe(5)
  })
})

// ─── Wicket with HitWicket method ────────────────────────────────────────────

describe('delivery: HitWicket dismissal', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
  })

  it('saves HitWicket to dismissals table', async () => {
    const players = db.prepare(`SELECT player_id FROM players LIMIT 2`).all()
    if (players.length < 2) return // skip if not enough test data
    const [batter, bowler] = players

    const res = await request(matchApp).post(`/api/matches/${fixtureId}/innings/1/delivery`).send({
      batter_id: batter.player_id,
      bowler_id: bowler.player_id,
      runs_bat: 0,
      dismissed_batter_id: batter.player_id,
      dismissal_method: 'HitWicket'
    })
    expect(res.status).toBe(200)

    const dis = db
      .prepare(
        `SELECT method FROM dismissals WHERE fixture_id = ? AND batter_id = ? AND innings_order = 1`
      )
      .get(fixtureId, batter.player_id)
    expect(dis).toBeDefined()
    expect(dis.method).toBe('HitWicket')
  })
})

// ─── Second fielder for run-outs ───────────────────────────────────────────────

describe('delivery: RunOut with second fielder', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
  })

  it('saves fielder2_id to dismissals table on a RunOut', async () => {
    const players = db.prepare(`SELECT player_id FROM players LIMIT 3`).all()
    if (players.length < 3) return
    const [batter, bowler, fielder2] = players

    const res = await request(matchApp).post(`/api/matches/${fixtureId}/innings/1/delivery`).send({
      batter_id: batter.player_id,
      bowler_id: bowler.player_id,
      runs_bat: 1,
      dismissed_batter_id: batter.player_id,
      dismissal_method: 'RunOut',
      dismissal_fielder2_id: fielder2.player_id
    })
    expect(res.status).toBe(200)

    const dis = db
      .prepare(
        `SELECT method, fielder2_id FROM dismissals WHERE fixture_id = ? AND batter_id = ? AND innings_order = 1`
      )
      .get(fixtureId, batter.player_id)
    expect(dis).toBeDefined()
    expect(dis.method).toBe('RunOut')
    expect(dis.fielder2_id).toBe(fielder2.player_id)
  })
})

// ─── DELETE delivery restores innings correctly ────────────────────────────────

describe('delivery: DELETE (undo)', () => {
  let fixtureId

  beforeAll(async () => {
    fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
  })

  it('DELETE removes the delivery row', async () => {
    const pid = db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
    const addRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 4 })
    expect(addRes.status).toBe(200)
    const deliveryId = addRes.body.id

    const delRes = await request(matchApp).delete(
      `/api/matches/${fixtureId}/delivery/${deliveryId}`
    )
    expect(delRes.status).toBe(200)
    expect(delRes.body.ok).toBe(true)

    const row = db.prepare(`SELECT id FROM deliveries WHERE id = ?`).get(deliveryId)
    expect(row).toBeUndefined()
  })

  it('DELETE removes associated dismissal', async () => {
    const players = db.prepare(`SELECT player_id FROM players LIMIT 2`).all()
    if (players.length < 2) return
    const [batter, bowler] = players

    const addRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({
        batter_id: batter.player_id,
        bowler_id: bowler.player_id,
        runs_bat: 0,
        dismissed_batter_id: batter.player_id,
        dismissal_method: 'Bowled'
      })
    expect(addRes.status).toBe(200)
    const deliveryId = addRes.body.id

    await request(matchApp).delete(`/api/matches/${fixtureId}/delivery/${deliveryId}`)

    const dis = db
      .prepare(
        `SELECT id FROM dismissals WHERE fixture_id = ? AND batter_id = ? AND innings_order = 1`
      )
      .get(fixtureId, batter.player_id)
    expect(dis).toBeUndefined()
  })
})
