/**
 * Access-control E2E tests.
 *
 * Prerequisites:
 *   1. CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, E2E_TEST_PASSWORD set.
 *   2. Test users created: node backend/scripts/setup-clerk-test-users.js
 *   3. E2E_USER_SUPER, E2E_USER_SCOPED, E2E_USER_MULTI, E2E_USER_NOACCESS set.
 *
 * Auth strategy: Clerk signInTokens API (backend SDK) creates a one-time ticket
 * for each test user. Navigating to /?__clerk_ticket={token} makes the Clerk
 * frontend exchange it for a full session automatically — no UI interaction needed,
 * no race conditions with page redirects.
 *
 * The test DB (test.sqlite) has fixture_seasons populated:
 *   - team_id 35534 (U11 Whirlwinds): fixtures 25577112, TEST_001–003  (4 matches)
 *   - team_id 47317 (U10 Hurricanes): fixtures TEST_004–005             (2 matches)
 */

import { test, expect } from '@playwright/test'
import { createClerkClient } from '@clerk/express'

const AUTH_API = `http://localhost:${process.env.E2E_AUTH_API_PORT || '3098'}`
const BASE_URL  = process.env.E2E_BASE_URL || 'http://localhost:5174'

const USER_SUPER    = process.env.E2E_USER_SUPER
const USER_SCOPED   = process.env.E2E_USER_SCOPED
const USER_MULTI    = process.env.E2E_USER_MULTI
const USER_NOACCESS = process.env.E2E_USER_NOACCESS

// Create a sign-in ticket for userId, navigate the page to the app with it,
// and return the session JWT once Clerk has established the session.
async function getTokenForUser(page, userId) {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const { token } = await clerk.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 120,
  })
  // Clerk automatically exchanges __clerk_ticket for a session on page load
  await page.goto(`${BASE_URL}/?__clerk_ticket=${token}`)
  // Wait until the Clerk session is active and has a token
  await page.waitForFunction(() => window.Clerk?.session?.id, { timeout: 30000 })
  return page.evaluate(() => window.Clerk.session.getToken())
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
    const token = await getTokenForUser(page, USER_SUPER)
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(6)
  })

  test('can access any fixture detail', async ({ page, request }) => {
    const token = await getTokenForUser(page, USER_SUPER)
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
    const token = await getTokenForUser(page, USER_SCOPED)
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
    const token = await getTokenForUser(page, USER_SCOPED)
    const res = await request.get(`${AUTH_API}/api/matches/TEST_004`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.fixture ?? body).toBeNull()
    } else {
      expect([403, 404]).toContain(res.status())
    }
  })
})

// ─── Multi-team user — sees both Whirlwinds and Hurricanes ───────────────────

test.describe('Multi-team user (Whirlwinds + Hurricanes)', () => {
  test('sees all 6 fixtures', async ({ page, request }) => {
    const token = await getTokenForUser(page, USER_MULTI)
    const matches = await getMatches(request, token)
    expect(matches.length).toBe(6)
  })

  test('has both Whirlwinds and Hurricanes matches', async ({ page, request }) => {
    const token = await getTokenForUser(page, USER_MULTI)
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
    const token = await getTokenForUser(page, USER_NOACCESS)
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
