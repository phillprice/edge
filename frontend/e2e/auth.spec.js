/**
 * Access-control E2E tests.
 *
 * Tests the scoping logic (fixture_seasons) at the HTTP API level using the
 * E2E_TEST_MODE backdoor in auth middleware. This lets us test different auth
 * contexts without a browser sign-in flow, making tests fast and reliable in CI.
 *
 * The backdoor is only active when E2E_TEST_MODE=true and NODE_ENV !== 'production'.
 * It accepts X-Test-Auth-Context: <JSON> in place of a real JWT.
 *
 * The test DB (test.sqlite) has fixture_seasons populated:
 *   - team_id 35534 (U11 Whirlwinds): fixtures 25577112, TEST_001–003  (4 matches)
 *   - team_id 47317 (U10 Hurricanes): fixtures TEST_004–005             (2 matches)
 */

import { test, expect } from '@playwright/test'

const AUTH_API = `http://localhost:${process.env.E2E_AUTH_API_PORT || '3098'}`

const SUPER_CTX    = { isSuperAdmin: true }
const SCOPED_CTX   = { groups: [{ team_id: 35534, season_id: 259 }] }
const MULTI_CTX    = { groups: [{ team_id: 35534, season_id: 259 }, { team_id: 47317, season_id: 259 }] }
const NOACCESS_CTX = { groups: [] }

function authHeader(ctx) {
  return { 'X-Test-Auth-Context': JSON.stringify(ctx) }
}

async function getMatches(request, ctx) {
  const res = await request.get(`${AUTH_API}/api/matches?limit=100`, {
    headers: authHeader(ctx),
  })
  expect(res.status()).toBe(200)
  return (await res.json()).matches ?? []
}

// ─── Super admin — sees all fixtures ──────────────────────────────────────────

test.describe('Super admin', () => {
  test('sees all 6 fixtures', async ({ request }) => {
    const matches = await getMatches(request, SUPER_CTX)
    expect(matches.length).toBe(6)
  })

  test('can access any fixture detail', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/matches/TEST_004`, {
      headers: authHeader(SUPER_CTX),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.fixture_id ?? body.fixture?.fixture_id).toBeDefined()
  })
})

// ─── Scoped user (one team) — sees only Whirlwinds fixtures ──────────────────

test.describe('Scoped user (Whirlwinds only)', () => {
  test('sees exactly 4 Whirlwinds fixtures', async ({ request }) => {
    const matches = await getMatches(request, SCOPED_CTX)
    expect(matches.length).toBe(4)
    for (const m of matches) {
      expect(
        m.home_team.toLowerCase().includes('whirlwind') ||
        m.away_team.toLowerCase().includes('whirlwind')
      ).toBe(true)
    }
  })

  test('cannot access a Hurricanes fixture', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/matches/TEST_004`, {
      headers: authHeader(SCOPED_CTX),
    })
    // Either 404 or the fixture field is null — not in this user's scope
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.fixture ?? body).toBeNull()
    } else {
      expect([403, 404]).toContain(res.status())
    }
  })
})

// ─── Multi-team user — sees both teams ───────────────────────────────────────

test.describe('Multi-team user (Whirlwinds + Hurricanes)', () => {
  test('sees all 6 fixtures', async ({ request }) => {
    const matches = await getMatches(request, MULTI_CTX)
    expect(matches.length).toBe(6)
  })

  test('has both Whirlwinds and Hurricanes matches', async ({ request }) => {
    const matches = await getMatches(request, MULTI_CTX)
    const hasWhirlwinds = matches.some(m =>
      m.home_team?.toLowerCase().includes('whirlwind') ||
      m.away_team?.toLowerCase().includes('whirlwind')
    )
    const hasHurricanes = matches.some(m =>
      m.home_team?.toLowerCase().includes('hurricane') ||
      m.away_team?.toLowerCase().includes('hurricane')
    )
    expect(hasWhirlwinds).toBe(true)
    expect(hasHurricanes).toBe(true)
  })
})

// ─── No-access user — sees nothing ───────────────────────────────────────────

test.describe('No-access user', () => {
  test('sees 0 fixtures', async ({ request }) => {
    const matches = await getMatches(request, NOACCESS_CTX)
    expect(matches.length).toBe(0)
  })
})

// ─── Unauthenticated — 401 on protected endpoints ────────────────────────────

test.describe('Unauthenticated', () => {
  test('GET /api/matches returns 401 without credentials', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/matches`)
    expect(res.status()).toBe(401)
  })

  test('GET /api/players returns 401 without credentials', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/players`)
    expect(res.status()).toBe(401)
  })
})
