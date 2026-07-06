'use strict'

const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')
delete process.env.CLERK_SECRET_KEY

const request = require('supertest')
const { seed } = require('../scripts/seed-test-db')
const { buildTestApp } = require('../routes/test-helpers')

const matchesRouter = require('../routes/matches/index')
const manualRouter = require('../routes/manual')

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

function getPlayerId() {
  return db.prepare(`SELECT player_id FROM players LIMIT 1`).get()?.player_id ?? 1
}

// ─── captain ────────────────────────────────────────────────────────────────

describe('handleCaptainPut', () => {
  let fixtureId
  beforeAll(async () => {
    fixtureId = await createFixture()
  })

  it('rejects missing innings_order/player_id', async () => {
    const res = await request(matchApp).put(`/api/matches/${fixtureId}/captain`).send({})
    expect(res.status).toBe(400)
  })

  it('sets a captain and can be upserted (ON CONFLICT)', async () => {
    const pid = getPlayerId()
    const res1 = await request(matchApp)
      .put(`/api/matches/${fixtureId}/captain`)
      .send({ innings_order: 1, player_id: pid })
    expect(res1.status).toBe(200)
    expect(res1.body.ok).toBe(true)

    const row1 = db
      .prepare('SELECT player_id FROM match_captains WHERE fixture_id = ? AND innings_order = 1')
      .get(fixtureId)
    expect(row1.player_id).toBe(pid)

    // Upsert with a different player
    const players = db.prepare('SELECT player_id FROM players LIMIT 2').all()
    const other = players.find((p) => p.player_id !== pid) ?? players[0]
    const res2 = await request(matchApp)
      .put(`/api/matches/${fixtureId}/captain`)
      .send({ innings_order: 1, player_id: other.player_id })
    expect(res2.status).toBe(200)
    const row2 = db
      .prepare('SELECT player_id FROM match_captains WHERE fixture_id = ? AND innings_order = 1')
      .get(fixtureId)
    expect(row2.player_id).toBe(other.player_id)
  })
})

// ─── wk assignments ─────────────────────────────────────────────────────────

describe('wk assignment handlers', () => {
  let fixtureId
  beforeAll(async () => {
    fixtureId = await createFixture()
  })

  it('POST rejects missing required fields', async () => {
    const res = await request(matchApp).post(`/api/matches/${fixtureId}/wk`).send({})
    expect(res.status).toBe(400)
  })

  it('POST rejects to_over < from_over', async () => {
    const pid = getPlayerId()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk`)
      .send({ innings_order: 1, player_id: pid, from_over: 5, to_over: 2 })
    expect(res.status).toBe(400)
  })

  let stintId
  it('POST creates a wk stint', async () => {
    const pid = getPlayerId()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk`)
      .send({ innings_order: 1, player_id: pid, from_over: 1, to_over: 10 })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    stintId = res.body.id
  })

  it('POST closes an open-ended existing stint when a new overlapping stint starts', async () => {
    const pid = getPlayerId()
    // Create an open-ended stint (no to_over)
    const openRes = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk`)
      .send({ innings_order: 2, player_id: pid, from_over: 1, to_over: null })
    expect(openRes.status).toBe(200)

    // New stint starting after — should close the previous one
    const res2 = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk`)
      .send({ innings_order: 2, player_id: pid, from_over: 5, to_over: null })
    expect(res2.status).toBe(200)
    const closed = db
      .prepare(
        'SELECT to_over FROM wk_assignments WHERE fixture_id = ? AND innings_order = 2 AND from_over = 1'
      )
      .get(fixtureId)
    expect(closed.to_over).toBe(4)
  })

  it('POST rejects an overlapping stint against a closed-ended stint', async () => {
    const pid = getPlayerId()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk`)
      .send({ innings_order: 1, player_id: pid, from_over: 3, to_over: 6 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Overlaps/)
  })

  it('PATCH updates to_over on an existing stint', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/wk/${stintId}`)
      .send({ to_over: 15 })
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT to_over FROM wk_assignments WHERE id = ?').get(stintId)
    expect(row.to_over).toBe(15)
  })

  it('PATCH rejects to_over below from_over', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/wk/${stintId}`)
      .send({ to_over: 0 })
    expect(res.status).toBe(400)
  })

  it('PATCH 404s for nonexistent stint', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/wk/999999`)
      .send({ to_over: 5 })
    expect(res.status).toBe(404)
  })

  it('DELETE removes a stint', async () => {
    const res = await request(matchApp).delete(`/api/matches/${fixtureId}/wk/${stintId}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const row = db.prepare('SELECT id FROM wk_assignments WHERE id = ?').get(stintId)
    expect(row).toBeUndefined()
  })
})

// ─── wk-error ───────────────────────────────────────────────────────────────

describe('wk-error handlers', () => {
  let fixtureId
  beforeAll(async () => {
    fixtureId = await createFixture()
  })

  it('POST rejects missing fields', async () => {
    const res = await request(matchApp).post(`/api/matches/${fixtureId}/wk-error`).send({})
    expect(res.status).toBe(400)
  })

  let errorId
  it('POST creates a wk error', async () => {
    const pid = getPlayerId()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/wk-error`)
      .send({ innings_order: 1, player_id: pid, error_type: 'dropped_catch' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    errorId = res.body.id
  })

  it('DELETE removes the wk error', async () => {
    const res = await request(matchApp).delete(`/api/matches/${fixtureId}/wk-error/${errorId}`)
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT id FROM wk_errors WHERE id = ?').get(errorId)
    expect(row).toBeUndefined()
  })
})

// ─── delivery PATCH ─────────────────────────────────────────────────────────

describe('handleDeliveryPatch', () => {
  let fixtureId, deliveryId

  beforeAll(async () => {
    fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
    const pid = getPlayerId()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 1 })
    deliveryId = res.body.id
  })

  it('404s for a nonexistent delivery', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/delivery/999999`)
      .send({ runs_bat: 4 })
    expect(res.status).toBe(404)
  })

  it('updates runs_bat on an existing delivery', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/delivery/${deliveryId}`)
      .send({ runs_bat: 4 })
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT runs_bat FROM deliveries WHERE id = ?').get(deliveryId)
    expect(row.runs_bat).toBe(4)
  })

  it('adds a dismissal when dismissed_batter_id + dismissal_method given', async () => {
    const players = db.prepare('SELECT player_id FROM players LIMIT 2').all()
    const [batter, bowler] = players
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/delivery/${deliveryId}`)
      .send({
        dismissed_batter_id: batter.player_id,
        dismissal_method: 'Bowled',
        dismissal_bowler_id: bowler.player_id
      })
    expect(res.status).toBe(200)
    const dis = db
      .prepare('SELECT method FROM dismissals WHERE fixture_id = ? AND batter_id = ?')
      .get(fixtureId, batter.player_id)
    expect(dis.method).toBe('Bowled')
  })

  it('updates an existing dismissal method without a batter_id change', async () => {
    const players = db.prepare('SELECT player_id FROM players LIMIT 2').all()
    const [batter] = players
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/delivery/${deliveryId}`)
      .send({ dismissal_method: 'Caught' })
    expect(res.status).toBe(200)
    const dis = db
      .prepare('SELECT method FROM dismissals WHERE fixture_id = ? AND batter_id = ?')
      .get(fixtureId, batter.player_id)
    expect(dis.method).toBe('Caught')
  })

  it('removes the dismissal when dismissed_batter_id set to null', async () => {
    const players = db.prepare('SELECT player_id FROM players LIMIT 2').all()
    const [batter] = players
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/delivery/${deliveryId}`)
      .send({ dismissed_batter_id: null })
    expect(res.status).toBe(200)
    const dis = db
      .prepare('SELECT id FROM dismissals WHERE fixture_id = ? AND batter_id = ?')
      .get(fixtureId, batter.player_id)
    expect(dis).toBeUndefined()
  })
})

// ─── pair-block ─────────────────────────────────────────────────────────────

describe('handlePairBlockPatch', () => {
  let fixtureId
  beforeAll(async () => {
    fixtureId = await createFixture({ format: 'pairs' })
    await ensureInnings(fixtureId, 1)
    const pid = getPlayerId()
    for (let i = 0; i < 12; i++) {
      await request(matchApp)
        .post(`/api/matches/${fixtureId}/innings/1/delivery`)
        .send({ batter_id: pid, bowler_id: pid, runs_bat: 1 })
    }
  })

  it('rejects missing required fields', async () => {
    const res = await request(matchApp).patch(`/api/matches/${fixtureId}/pair-block`).send({})
    expect(res.status).toBe(400)
  })

  it('404s when innings not found', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/pair-block`)
      .send({ innings_order: 99, over_start: 1, over_end: 2, batter1_id: 1, batter2_id: 2 })
    expect(res.status).toBe(404)
  })

  it('404s when no deliveries found in the over range', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/pair-block`)
      .send({ innings_order: 1, over_start: 90, over_end: 95, batter1_id: 1, batter2_id: 2 })
    expect(res.status).toBe(404)
  })

  it('remaps batters within the given over range', async () => {
    const players = db.prepare('SELECT player_id FROM players LIMIT 2').all()
    const [p1, p2] = players
    const res = await request(matchApp).patch(`/api/matches/${fixtureId}/pair-block`).send({
      innings_order: 1,
      over_start: 1,
      over_end: 2,
      batter1_id: p1.player_id,
      batter2_id: p2.player_id
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ─── result PATCH ───────────────────────────────────────────────────────────

describe('handleResultPatch', () => {
  let fixtureId
  beforeAll(async () => {
    fixtureId = await createFixture()
  })

  it('404s for a nonexistent fixture', async () => {
    const res = await request(matchApp)
      .patch('/api/matches/NOT_A_FIXTURE/result')
      .send({ result: 'won' })
    expect(res.status).toBe(404)
  })

  it('400s when no fields to update', async () => {
    const res = await request(matchApp).patch(`/api/matches/${fixtureId}/result`).send({})
    expect(res.status).toBe(400)
  })

  it('updates allowed scalar fields', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/result`)
      .send({ home_score: '150', away_score: '140', result: 'won' })
    expect(res.status).toBe(200)
    const row = db
      .prepare('SELECT home_score, result FROM fixtures WHERE fixture_id = ?')
      .get(fixtureId)
    expect(row.home_score).toBe('150')
    expect(row.result).toBe('won')
  })

  it('rejects invalid tags[]', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/result`)
      .send({ tags: ['not-a-real-tag'] })
    expect(res.status).toBe(400)
  })

  it('accepts valid tags[]', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/result`)
      .send({ tags: ['cup'] })
    expect(res.status).toBe(200)
  })

  it('rejects invalid legacy match_type', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/result`)
      .send({ match_type: 'not-a-real-type' })
    expect(res.status).toBe(400)
  })

  it('accepts valid legacy match_type', async () => {
    const res = await request(matchApp)
      .patch(`/api/matches/${fixtureId}/result`)
      .send({ match_type: 'league' })
    expect(res.status).toBe(200)
  })
})

// ─── innings POST ───────────────────────────────────────────────────────────

describe('handleInningsPost', () => {
  it('rejects non-manual fixture ids', async () => {
    const res = await request(matchApp)
      .post('/api/matches/25577112/innings')
      .send({ innings_order: 1 })
    expect(res.status).toBe(403)
  })

  it('rejects invalid innings_order', async () => {
    const fixtureId = await createFixture()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings`)
      .send({ innings_order: 3 })
    expect(res.status).toBe(400)
  })

  it('404s for nonexistent manual fixture id', async () => {
    const res = await request(matchApp)
      .post('/api/matches/manual-doesnotexist/innings')
      .send({ innings_order: 1 })
    expect(res.status).toBe(404)
  })

  it('creates innings and returns created:true then created:false on repeat', async () => {
    const fixtureId = await createFixture()
    const res1 = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings`)
      .send({ innings_order: 1 })
    expect(res1.status).toBe(200)
    expect(res1.body.created).toBe(true)

    const res2 = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings`)
      .send({ innings_order: 1 })
    expect(res2.status).toBe(200)
    expect(res2.body.created).toBe(false)
    expect(res2.body.result_id).toBe(res1.body.result_id)
  })
})

// ─── delivery POST validations ──────────────────────────────────────────────

describe('handleDeliveryPost validations', () => {
  it('rejects non-manual fixture ids', async () => {
    const res = await request(matchApp)
      .post('/api/matches/25577112/innings/1/delivery')
      .send({ batter_id: 1, bowler_id: 1 })
    expect(res.status).toBe(403)
  })

  it('rejects invalid inningsOrder', async () => {
    const fixtureId = await createFixture()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/9/delivery`)
      .send({ batter_id: 1, bowler_id: 1 })
    expect(res.status).toBe(400)
  })

  it('404s when innings does not exist yet', async () => {
    const fixtureId = await createFixture()
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: 1, bowler_id: 1 })
    expect(res.status).toBe(404)
  })

  it('rejects missing batter_id/bowler_id', async () => {
    const fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: null, bowler_id: null })
    expect(res.status).toBe(400)
  })

  it('records a RunOut dismissal with fielder2_id but no bowler credit', async () => {
    const fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
    const players = db.prepare('SELECT player_id FROM players LIMIT 3').all()
    const [batter, bowler, fielder2] = players
    const res = await request(matchApp).post(`/api/matches/${fixtureId}/innings/1/delivery`).send({
      batter_id: batter.player_id,
      bowler_id: bowler.player_id,
      runs_bat: 1,
      dismissed_batter_id: batter.player_id,
      dismissal_method: 'RunOut',
      dismissal_bowler_id: bowler.player_id,
      dismissal_fielder2_id: fielder2.player_id
    })
    expect(res.status).toBe(200)
    const dis = db
      .prepare(
        'SELECT method, bowler_id, fielder2_id FROM dismissals WHERE fixture_id = ? AND batter_id = ?'
      )
      .get(fixtureId, batter.player_id)
    expect(dis.method).toBe('RunOut')
    expect(dis.bowler_id).toBeNull() // RunOut never credits the bowler
    expect(dis.fielder2_id).toBe(fielder2.player_id)
  })

  it('records a Caught dismissal with fielder_id credit', async () => {
    const fixtureId = await createFixture()
    await ensureInnings(fixtureId, 1)
    const players = db.prepare('SELECT player_id FROM players LIMIT 3').all()
    const [batter, bowler, fielder] = players
    const res = await request(matchApp).post(`/api/matches/${fixtureId}/innings/1/delivery`).send({
      batter_id: batter.player_id,
      bowler_id: bowler.player_id,
      runs_bat: 0,
      dismissed_batter_id: batter.player_id,
      dismissal_method: 'Caught',
      dismissal_fielder_id: fielder.player_id
    })
    expect(res.status).toBe(200)
    const dis = db
      .prepare('SELECT fielder_id FROM dismissals WHERE fixture_id = ? AND batter_id = ?')
      .get(fixtureId, batter.player_id)
    expect(dis.fielder_id).toBe(fielder.player_id)
  })

  it('respects max_overs — no_ball_rebowl="last_over" makes a no-ball legal only in the final over', async () => {
    const fixtureId = await createFixture({ no_ball_rebowl: 'last_over' })
    // max_overs isn't settable via the manual-fixture creation route — set it directly.
    db.prepare('UPDATE fixtures SET max_overs = 1 WHERE fixture_id = ?').run(fixtureId)
    await ensureInnings(fixtureId, 1)
    const pid = getPlayerId()
    // 5 normal deliveries in over 0 (the last over since max_overs=1)
    for (let i = 0; i < 5; i++) {
      await request(matchApp)
        .post(`/api/matches/${fixtureId}/innings/1/delivery`)
        .send({ batter_id: pid, bowler_id: pid, runs_bat: 0 })
    }
    // A no-ball as the 6th ball — since it's the last over, no-ball counts as legal
    const res = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0, runs_extra: 1, extras_type: 1 })
    expect(res.status).toBe(200)
    expect(res.body.over_no).toBe(0)
    // 7th delivery should start over 1
    const next = await request(matchApp)
      .post(`/api/matches/${fixtureId}/innings/1/delivery`)
      .send({ batter_id: pid, bowler_id: pid, runs_bat: 0 })
    expect(next.body.over_no).toBe(1)
  })
})

// ─── delivery DELETE ────────────────────────────────────────────────────────

describe('handleDeliveryDelete', () => {
  it('rejects non-manual fixture ids', async () => {
    const res = await request(matchApp).delete('/api/matches/25577112/delivery/1')
    expect(res.status).toBe(403)
  })

  it('404s for a nonexistent delivery', async () => {
    const fixtureId = await createFixture()
    const res = await request(matchApp).delete(`/api/matches/${fixtureId}/delivery/999999`)
    expect(res.status).toBe(404)
  })
})
