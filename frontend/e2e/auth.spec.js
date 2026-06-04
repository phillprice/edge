/**
 * Access-control E2E tests.
 *
 * Prerequisites:
 *   1. CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, E2E_TEST_PASSWORD set.
 *   2. Test users created: node backend/scripts/setup-clerk-test-users.js
 *   3. E2E_USER_SUPER, E2E_USER_SCOPED, E2E_USER_MULTI, E2E_USER_NOACCESS set.
 *
 * Tests run against the auth backend (port E2E_AUTH_API_PORT, default 3098)
 * which has CLERK_SECRET_KEY set — unlike the smoke backend which disables auth.
 *
 * The test DB (test.sqlite) has fixture_seasons populated:
 *   - team_id 35534 (U11 Whirlwinds): fixtures 25577112, TEST_001–003
 *   - team_id 47317 (U10 Hurricanes): fixtures TEST_004–005
 */

import { test, expect } from '@playwright/test'
import { setupClerkTestingToken, clerk } from '@clerk/testing/playwright'

const AUTH_API = `http://localhost:${process.env.E2E_AUTH_API_PORT || '3098'}`

const PASSWORD  = process.env.E2E_TEST_PASSWORD || 'E2eTestP@ss123!'
const SUPER     = 'e2e-superadmin+clerk_test@phillprice.com'
const SCOPED    = 'e2e-scoped+clerk_test@phillprice.com'
const MULTI     = 'e2e-multiteam+clerk_test@phillprice.com'
const NOACCESS  = 'e2e-noaccess+clerk_test@phillprice.com'

async function signIn(page, email) {
  await setupClerkTestingToken({ page })
  await clerk.signIn({ page, signInParams: { strategy: 'password', identifier: email, password: PASSWORD } })
}

async function getMatches(request, token) {
  const res = await request.get(`${AUTH_API}/api/matches?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  return (await res.json()).matches ?? []
}

// ─── Super admin — sees all fixtures ──────────────────────────────────────────

test.describe('Super admin', () => {
  test('sees all 6 fixtures', async ({ page, request }) => {
    await signIn(page, SUPER)
    const token = await page.evaluate(() =>
      window.Clerk?.session?.getToken()
    )
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(6)
  })

  test('can access any fixture detail', async ({ page, request }) => {
    await signIn(page, SUPER)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    const res = await request.get(`${AUTH_API}/api/matches/TEST_004`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.fixture_id ?? body.fixture?.fixture_id).toBeDefined()
  })
})

// ─── Scoped user (one team) — sees only Whirlwinds fixtures ──────────────────

test.describe('Scoped user (Whirlwinds only)', () => {
  test('sees exactly 4 Whirlwinds fixtures', async ({ page, request }) => {
    await signIn(page, SCOPED)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(4)
    for (const m of matches) {
      expect(
        m.home_team.toLowerCase().includes('whirlwind') ||
        m.away_team.toLowerCase().includes('whirlwind')
      ).toBe(true)
    }
  })

  test('cannot access a Hurricanes fixture', async ({ page, request }) => {
    await signIn(page, SCOPED)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    // TEST_004 belongs to Hurricanes (team_id 47317) — scoped user has no access
    const res = await request.get(`${AUTH_API}/api/matches/TEST_004`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Either 404 (not found in their scope) or empty/null fixture
    if (res.status() === 200) {
      const body = await res.json()
      // If 200, the fixture data should be empty/null (not their team)
      expect(body.fixture ?? body).toBeNull()
    } else {
      expect([403, 404]).toContain(res.status())
    }
  })
})

// ─── Multi-team user — sees both Whirlwinds and Hurricanes ───────────────────

test.describe('Multi-team user (Whirlwinds + Hurricanes)', () => {
  test('sees all 6 fixtures', async ({ page, request }) => {
    await signIn(page, MULTI)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(6)
  })

  test('has both Whirlwinds and Hurricanes matches', async ({ page, request }) => {
    await signIn(page, MULTI)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    const matches = await getMatches(request, token)
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
  test('sees 0 fixtures', async ({ page, request }) => {
    await signIn(page, NOACCESS)
    const token = await page.evaluate(() => window.Clerk?.session?.getToken())
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(0)
  })
})

// ─── Unauthenticated — 401 on protected endpoints ────────────────────────────

test.describe('Unauthenticated', () => {
  test('GET /api/matches returns 401 without token', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/matches`)
    expect(res.status()).toBe(401)
  })

  test('GET /api/players returns 401 without token', async ({ request }) => {
    const res = await request.get(`${AUTH_API}/api/players`)
    expect(res.status()).toBe(401)
  })
})
