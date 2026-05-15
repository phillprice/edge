import { test, expect } from '@playwright/test'

const API = 'http://localhost:3001'
const KNOWN_FIXTURE = '25577112' // WHCC U11 Whirlwinds vs Weybridge, 29 Apr 2026

// ─── API contract tests ────────────────────────────────────────────────────

test.describe('API: /api/matches', () => {
  test('returns paginated match list', async ({ request }) => {
    const res = await request.get(`${API}/api/matches?limit=5`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('matches')
    expect(Array.isArray(body.matches)).toBe(true)
    expect(body.matches.length).toBeGreaterThan(0)
    expect(body).toHaveProperty('total')
    const m = body.matches[0]
    expect(m).toHaveProperty('fixture_id')
    expect(m).toHaveProperty('home_team')
    expect(m).toHaveProperty('away_team')
    expect(m).toHaveProperty('match_date')
  })

  test('limit and offset pagination work', async ({ request }) => {
    const page1 = await (await request.get(`${API}/api/matches?limit=3&offset=0`)).json()
    const page2 = await (await request.get(`${API}/api/matches?limit=3&offset=3`)).json()
    expect(page1.matches.length).toBe(3)
    const ids1 = page1.matches.map(m => m.fixture_id)
    const ids2 = page2.matches.map(m => m.fixture_id)
    expect(ids1.some(id => ids2.includes(id))).toBe(false)
  })
})

test.describe('API: /api/matches/:id', () => {
  test('returns fixture, scorecards, and partnerships', async ({ request }) => {
    const res = await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('fixture')
    expect(body.fixture.fixture_id).toBe(KNOWN_FIXTURE)
    expect(Array.isArray(body.scorecards)).toBe(true)
    expect(body.scorecards.length).toBeGreaterThan(0)
    expect(Array.isArray(body.partnerships)).toBe(true)
  })

  test('scorecards have totals and batting/bowling', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const sc of scorecards) {
      expect(sc).toHaveProperty('totals')
      expect(sc.totals).toHaveProperty('runs')
      expect(sc.totals).toHaveProperty('wickets')
      expect(Array.isArray(sc.batting)).toBe(true)
      expect(Array.isArray(sc.bowling)).toBe(true)
    }
  })

  test('partnerships include per-batter stats', async ({ request }) => {
    const { partnerships } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    if (partnerships.length > 0) {
      const p = partnerships[0]
      expect(p).toHaveProperty('batter1_id')
      expect(p).toHaveProperty('batter2_id')
      expect(p).toHaveProperty('runs')
      expect(p).toHaveProperty('batter1_runs')
      expect(p).toHaveProperty('batter2_runs')
    }
  })

  test('returns 404 for unknown fixture', async ({ request }) => {
    const res = await request.get(`${API}/api/matches/nonexistent_id`)
    expect(res.status()).toBe(404)
  })
})

test.describe('API: /api/matches/:id/roles', () => {
  test('returns captain and WK stints per innings', async ({ request }) => {
    const res = await request.get(`${API}/api/matches/${KNOWN_FIXTURE}/roles`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(typeof body).toBe('object')
    const innings = Object.values(body)
    expect(innings.length).toBeGreaterThan(0)
    const inn = innings[0]
    expect(inn).toHaveProperty('players')
    expect(Array.isArray(inn.players)).toBe(true)
    expect(inn).toHaveProperty('wk_stints')
    expect(inn).toHaveProperty('wk_errors')
  })

  test('squad includes players who only fielded', async ({ request }) => {
    const body = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}/roles`)).json()
    const allPlayerNames = Object.values(body).flatMap(inn => inn.players.map(p => p.name))
    // S L and Zac Henderson attended but didn't bat or bowl
    expect(allPlayerNames.some(n => n.includes('S L') || n.includes('Sam L'))).toBe(true)
  })
})

test.describe('API: /api/players/stats', () => {
  test('returns player array with batting and bowling stats', async ({ request }) => {
    const res = await request.get(`${API}/api/players/stats`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('players')
    expect(Array.isArray(body.players)).toBe(true)
    expect(body.players.length).toBeGreaterThan(0)
    const p = body.players[0]
    expect(p).toHaveProperty('player_id')
    expect(p).toHaveProperty('name')
    expect(p).toHaveProperty('games_attended')
    expect(p).toHaveProperty('runs')
  })

  test('year filter returns subset of results', async ({ request }) => {
    const all  = await (await request.get(`${API}/api/players/stats`)).json()
    const y25  = await (await request.get(`${API}/api/players/stats?year=2025`)).json()
    expect(y25.players.length).toBeLessThanOrEqual(all.players.length)
  })

  test('team filter accepts whirlwind and hurricane', async ({ request }) => {
    const ww = await (await request.get(`${API}/api/players/stats?team=whirlwind`)).json()
    const hh = await (await request.get(`${API}/api/players/stats?team=hurricane`)).json()
    expect(ww.players.length).toBeGreaterThan(0)
    expect(hh.players.length).toBeGreaterThan(0)
    const wwIds = new Set(ww.players.map(p => p.player_id))
    expect(hh.players.some(p => wwIds.has(p.player_id))).toBe(false)
  })
})

test.describe('API: /api/players/names', () => {
  test('returns array of WHCC display names', async ({ request }) => {
    const res = await request.get(`${API}/api/players/names`)
    expect(res.status()).toBe(200)
    const names = await res.json()
    expect(Array.isArray(names)).toBe(true)
    expect(names.length).toBeGreaterThan(0)
    expect(typeof names[0]).toBe('string')
  })
})

test.describe('API: /api/health', () => {
  test('returns ok', async ({ request }) => {
    const res = await request.get(`${API}/api/health`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('time')
  })
})

// ─── Frontend smoke tests ──────────────────────────────────────────────────

function isAuthRedirect(url) {
  return url.includes('accounts.') || url.includes('clerk') || url.includes('sign-in')
}

test('home page loads without crashing', async ({ page }) => {
  await page.goto('/')
  await expect(page).not.toHaveURL(/error/)
  if (!isAuthRedirect(page.url())) {
    await expect(page.locator('body')).not.toBeEmpty()
  }
})

test('no app-level console errors on home page', async ({ page }) => {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const appErrors = errors.filter(e =>
    !e.includes('clerk') &&
    !e.includes('sentry') &&
    !e.includes('favicon') &&
    !e.includes('Failed to load resource') &&
    !e.includes('net::ERR') &&
    !e.includes('ResizeObserver')
  )
  expect(appErrors).toHaveLength(0)
})

test('match list shows match cards when authenticated', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  if (isAuthRedirect(page.url())) return // skip if Clerk redirected
  // Should have at least one match card or list item
  const cards = page.locator('.card, [class*="match"]')
  await expect(cards.first()).toBeVisible({ timeout: 5000 })
})

test('match detail page loads without crashing', async ({ page }) => {
  await page.goto(`/match/${KNOWN_FIXTURE}`)
  await expect(page).not.toHaveURL(/error/)
  if (!isAuthRedirect(page.url())) {
    await expect(page.locator('body')).not.toBeEmpty()
    const errors = []
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
    await page.waitForLoadState('networkidle')
    const appErrors = errors.filter(e =>
      !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR')
    )
    expect(appErrors).toHaveLength(0)
  }
})

test('player list page loads without crashing', async ({ page }) => {
  await page.goto('/players')
  await expect(page).not.toHaveURL(/error/)
  if (!isAuthRedirect(page.url())) {
    await expect(page.locator('body')).not.toBeEmpty()
  }
})
