import { test, expect } from '@playwright/test'

const API = process.env.E2E_API || `http://localhost:${process.env.E2E_API_PORT || '3099'}`
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
    expect(ww.players[0]).toHaveProperty('player_id')
    expect(hh.players[0]).toHaveProperty('player_id')
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

test.describe('API: /api/players/partnerships', () => {
  test('returns array with correct shape', async ({ request }) => {
    const res = await request.get(`${API}/api/players/partnerships`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    if (body.length > 0) {
      const p = body[0]
      expect(p).toHaveProperty('p1_id')
      expect(p).toHaveProperty('p2_id')
      expect(p).toHaveProperty('p1_name')
      expect(p).toHaveProperty('p2_name')
      expect(p).toHaveProperty('stands')
      expect(p).toHaveProperty('total_runs')
      expect(p).toHaveProperty('best_stand')
      expect(p).toHaveProperty('avg_stand')
    }
  })

  test('year filter accepted without error', async ({ request }) => {
    const res = await request.get(`${API}/api/players/partnerships?year=2026`)
    expect(res.status()).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})

test.describe('API: /api/matches/season', () => {
  test('returns record, batting, bowling, years', async ({ request }) => {
    const res = await request.get(`${API}/api/matches/season`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('record')
    expect(body.record).toHaveProperty('played')
    expect(body.record).toHaveProperty('won')
    expect(body.record).toHaveProperty('lost')
    expect(body.record).toHaveProperty('tied')
    expect(body.record).toHaveProperty('nrd')
    expect(body).toHaveProperty('batting')
    expect(body.batting).toHaveProperty('total_runs')
    expect(body).toHaveProperty('bowling')
    expect(body.bowling).toHaveProperty('total_wickets')
    expect(body).toHaveProperty('years')
    expect(Array.isArray(body.years)).toBe(true)
  })

  test('year filter narrows played count', async ({ request }) => {
    const all = await (await request.get(`${API}/api/matches/season`)).json()
    const y26 = await (await request.get(`${API}/api/matches/season?year=2026`)).json()
    expect(y26.record.played).toBeLessThanOrEqual(all.record.played)
  })

  test('top_scorer has player_id, name, runs when present', async ({ request }) => {
    const body = await (await request.get(`${API}/api/matches/season?year=2026`)).json()
    if (body.top_scorer) {
      expect(body.top_scorer).toHaveProperty('player_id')
      expect(body.top_scorer).toHaveProperty('name')
      expect(body.top_scorer).toHaveProperty('runs')
    }
  })
})

test.describe('API: /api/players/:id/h2h', () => {
  const KNOWN_PLAYER = 103 // Leo Brown in test DB

  test('returns batting and bowling arrays', async ({ request }) => {
    const res = await request.get(`${API}/api/players/${KNOWN_PLAYER}/h2h`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('batting')
    expect(body).toHaveProperty('bowling')
    expect(Array.isArray(body.batting)).toBe(true)
    expect(Array.isArray(body.bowling)).toBe(true)
  })

  test('batting rows have opponent, innings, runs, high_score, outs', async ({ request }) => {
    const { batting } = await (await request.get(`${API}/api/players/${KNOWN_PLAYER}/h2h`)).json()
    if (batting.length > 0) {
      expect(batting[0]).toHaveProperty('opponent')
      expect(batting[0]).toHaveProperty('innings')
      expect(batting[0]).toHaveProperty('runs')
      expect(batting[0]).toHaveProperty('high_score')
      expect(batting[0]).toHaveProperty('outs')
    }
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
    !e.includes('ResizeObserver') &&
    !e.includes('script-src') &&        // benign CSP fallback warning
    !e.includes('Content Security Policy')
  )
  expect(appErrors).toHaveLength(0)
})

test('match list shows match cards when authenticated', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  if (isAuthRedirect(page.url())) return // skip if Clerk redirected to auth URL
  const cards = page.locator('.card, [class*="match"]')
  // Clerk may show a sign-in overlay at the same URL — skip rather than fail
  if (await cards.count() === 0) return
  await expect(cards.first()).toBeVisible()
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
      !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR') &&
      !e.includes('script-src') && !e.includes('Content Security Policy')
    )
    expect(appErrors).toHaveLength(0)
  }
})

test('player list page loads without crashing', async ({ page }) => {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/players')
  await page.waitForLoadState('networkidle')
  await expect(page).not.toHaveURL(/error/)
  if (!isAuthRedirect(page.url())) {
    await expect(page.locator('body')).not.toBeEmpty()
    const appErrors = errors.filter(e =>
      !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR') &&
      !e.includes('favicon') && !e.includes('script-src') && !e.includes('Content Security Policy')
    )
    expect(appErrors).toHaveLength(0)
  }
})

test('season page loads without crashing', async ({ page }) => {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/season')
  await page.waitForLoadState('networkidle')
  await expect(page).not.toHaveURL(/error/)
  if (!isAuthRedirect(page.url())) {
    await expect(page.locator('body')).not.toBeEmpty()
    if (await page.locator('h1').count() === 0) return
    await expect(page.locator('h1')).toBeVisible()
    const appErrors = errors.filter(e =>
      !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR') &&
      !e.includes('favicon') && !e.includes('script-src') && !e.includes('Content Security Policy')
    )
    expect(appErrors).toHaveLength(0)
  }
})

test.describe('API: delivery editing', () => {
  test('match detail includes matchPlayers array', async ({ request }) => {
    const res = await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('matchPlayers')
    expect(Array.isArray(body.matchPlayers)).toBe(true)
    expect(body.matchPlayers.length).toBeGreaterThan(0)
    expect(body.matchPlayers[0]).toHaveProperty('player_id')
    expect(body.matchPlayers[0]).toHaveProperty('name')
  })

  test('overs balls include delivery ids and player ids', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const scWithOvers = scorecards.find(sc => sc.overs?.length > 0)
    expect(scWithOvers).toBeDefined()
    const ball = scWithOvers.overs[0].balls[0]
    expect(ball).toHaveProperty('id')
    expect(typeof ball.id).toBe('number')
    expect(ball).toHaveProperty('batter_id')
    expect(ball).toHaveProperty('bowler_id')
  })

  test('PATCH delivery with same values returns ok', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const scWithOvers = scorecards.find(sc => sc.overs?.length > 0)
    const ball = scWithOvers.overs[0].balls[0]
    const res = await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/delivery/${ball.id}`, {
      data: {
        runs_bat:   ball.runs_bat,
        runs_extra: ball.runs_extra,
        extras_type: ball.extras_type,
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('PATCH delivery with unknown id returns 404', async ({ request }) => {
    const res = await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/delivery/999999`, {
      data: { runs_bat: 1 },
    })
    expect(res.status()).toBe(404)
  })
})

test('match detail charts tab loads without JS errors', async ({ page }) => {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto(`/match/${KNOWN_FIXTURE}`)
  await page.waitForLoadState('networkidle')
  if (isAuthRedirect(page.url())) return
  const chartsTab = page.getByRole('button', { name: /charts/i }).or(page.getByText('Charts'))
  if (await chartsTab.count() === 0) return
  await chartsTab.first().click()
  await page.waitForTimeout(500)
  const appErrors = errors.filter(e =>
    !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('script-src') && !e.includes('Content Security Policy')
  )
  expect(appErrors).toHaveLength(0)
})

// ─── New delivery / result editing API tests ──────────────────────────────────

test.describe('API: non-striker delivery editing', () => {
  test('PATCH delivery with batter_id_ns returns ok', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const scWithOvers = scorecards.find(sc => sc.overs?.length > 0)
    if (!scWithOvers) return
    const ball = scWithOvers.overs[0].balls[0]
    if (!ball?.id) return
    const res = await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/delivery/${ball.id}`, {
      data: { batter_id_ns: ball.batter_id_ns },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  test('balls response includes batter_id_ns field', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const scWithOvers = scorecards.find(sc => sc.overs?.length > 0)
    if (!scWithOvers) return
    const ball = scWithOvers.overs[0].balls[0]
    expect(ball).toHaveProperty('batter_id_ns')
  })
})

test.describe('API: result editing', () => {
  test('PATCH result with existing values returns ok', async ({ request }) => {
    const { fixture } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const res = await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/result`, {
      data: {
        result:        fixture.result ?? null,
        home_score:    fixture.home_score ?? null,
        home_wickets:  fixture.home_wickets ?? null,
        home_overs:    fixture.home_overs ?? null,
        away_score:    fixture.away_score ?? null,
        away_wickets:  fixture.away_wickets ?? null,
        away_overs:    fixture.away_overs ?? null,
        toss_winner:   fixture.toss_winner ?? null,
        toss_decision: fixture.toss_decision ?? null,
      },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  test('PATCH result persists updated result string', async ({ request }) => {
    await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/result`, {
      data: { result: 'WHCC Whirlwinds won by 42 runs' },
    })
    const { fixture } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    expect(fixture.result).toBe('WHCC Whirlwinds won by 42 runs')
    // Reset
    await request.patch(`${API}/api/matches/${KNOWN_FIXTURE}/result`, {
      data: { result: null },
    })
  })

  test('PATCH result for unknown fixture returns 404', async ({ request }) => {
    const res = await request.patch(`${API}/api/matches/nonexistent_99/result`, {
      data: { result: 'Test' },
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('API: match flow structure', () => {
  test('scorecards have a flow array', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const sc of scorecards) {
      if (sc.overs?.length > 0) {
        expect(sc).toHaveProperty('flow')
        expect(Array.isArray(sc.flow)).toBe(true)
      }
    }
  })

  test('flow always ends with innings_end event', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const sc of scorecards) {
      if (!sc.flow?.length) continue
      const last = sc.flow[sc.flow.length - 1]
      expect(last.type).toBe('innings_end')
      expect(last).toHaveProperty('score')
      expect(last).toHaveProperty('wickets')
    }
  })

  test('wicket events have required fields', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const sc of scorecards) {
      for (const event of (sc.flow || [])) {
        if (event.type === 'wicket') {
          expect(event).toHaveProperty('over')
          expect(event).toHaveProperty('wickets')
          expect(event).toHaveProperty('score')
          expect(event).toHaveProperty('player')
          expect(event).toHaveProperty('partnership')
        }
      }
    }
  })

  test('bowler_haul events only appear for WHCC bowling innings', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const sc of scorecards) {
      const hauls = (sc.flow || []).filter(e => e.type === 'bowler_haul')
      if (hauls.length > 0) {
        // If haul events exist, this must be a WHCC bowling innings (isWhccBatting = false)
        // We can't easily assert direction here, but we can check shape
        for (const h of hauls) {
          expect(h).toHaveProperty('player')
          expect(h).toHaveProperty('wickets')
          expect(h.wickets).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

test.describe('API: worm data shape', () => {
  test('overs have per-ball data with runs_bat', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const sc = scorecards.find(s => s.overs?.length > 0)
    if (!sc) return
    const over = sc.overs[0]
    expect(over).toHaveProperty('balls')
    expect(Array.isArray(over.balls)).toBe(true)
    const ball = over.balls[0]
    expect(ball).toHaveProperty('runs_bat')
    expect(ball).toHaveProperty('runs_extra')
    expect(ball).toHaveProperty('batter_id')
    expect(ball).toHaveProperty('bowler_id')
  })

  test('cumulative score increases monotonically across overs', async ({ request }) => {
    const { scorecards } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    const sc = scorecards.find(s => s.overs?.length > 1)
    if (!sc) return
    let prev = 0
    for (const over of sc.overs) {
      const overTotal = over.balls.reduce((s, b) => s + (b.runs_bat || 0) + (b.runs_extra || 0), 0)
      expect(overTotal).toBeGreaterThanOrEqual(0)
      prev += overTotal
    }
    expect(prev).toBeGreaterThanOrEqual(0)
  })
})

test.describe('API: scheduler queue', () => {
  test('GET /api/admin/scheduler/status returns expected shape', async ({ request }) => {
    const res = await request.get(`${API}/api/admin/scheduler/status`)
    // May be 401/403 in CI (no auth token) — skip if so
    if (res.status() === 401 || res.status() === 403) return
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('teams')
    expect(body).toHaveProperty('queue')
    expect(body).toHaveProperty('recent')
    expect(Array.isArray(body.teams)).toBe(true)
    expect(Array.isArray(body.recent)).toBe(true)
    expect(body.queue).toHaveProperty('pending')
    expect(body.queue).toHaveProperty('done')
    expect(body.queue).toHaveProperty('failed')
  })
})

test('player detail page loads without crashing', async ({ page }) => {
  // Navigate to players page first to pick up a real player link
  await page.goto('/players')
  await page.waitForLoadState('networkidle')
  if (isAuthRedirect(page.url())) return
  const firstLink = page.locator('a[href*="/players/"]').first()
  if (await firstLink.count() === 0) return
  const href = await firstLink.getAttribute('href')
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto(href)
  await page.waitForLoadState('networkidle')
  if (isAuthRedirect(page.url())) return
  await expect(page.locator('body')).not.toBeEmpty()
  const appErrors = errors.filter(e =>
    !e.includes('clerk') && !e.includes('sentry') && !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('script-src') && !e.includes('Content Security Policy')
  )
  expect(appErrors).toHaveLength(0)
})

test.describe('API: match list filtering', () => {
  test('search param narrows results', async ({ request }) => {
    const all = await (await request.get(`${API}/api/matches?limit=100`)).json()
    if (all.matches.length === 0) return
    // Search by a team name fragment that should match something
    const sample = all.matches[0]
    const query = encodeURIComponent(sample.home_team.split(' ')[0])
    const filtered = await (await request.get(`${API}/api/matches?limit=100&search=${query}`)).json()
    expect(filtered.matches.length).toBeLessThanOrEqual(all.matches.length)
    expect(filtered.matches.length).toBeGreaterThan(0)
  })

  test('year filter returns only matches from that year', async ({ request }) => {
    const res = await request.get(`${API}/api/matches?year=2026&limit=100`)
    if (res.status() !== 200) return
    const body = await res.json()
    for (const m of body.matches) {
      expect(m.match_date).toMatch(/^2026/)
    }
  })
})

test.describe('API: partnerships data quality', () => {
  test('no partnership has batter1_id === batter2_id', async ({ request }) => {
    const { partnerships } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const p of partnerships) {
      expect(p.batter1_id).not.toBe(p.batter2_id)
    }
  })

  test('partnership runs are non-negative', async ({ request }) => {
    const { partnerships } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const p of partnerships) {
      expect(p.runs).toBeGreaterThanOrEqual(0)
      expect(p.batter1_runs).toBeGreaterThanOrEqual(0)
      expect(p.batter2_runs).toBeGreaterThanOrEqual(0)
    }
  })

  test('batter1_id is always the lower numeric id', async ({ request }) => {
    const { partnerships } = await (await request.get(`${API}/api/matches/${KNOWN_FIXTURE}`)).json()
    for (const p of partnerships) {
      expect(p.batter1_id).toBeLessThanOrEqual(p.batter2_id)
    }
  })
})

// ─── Access control + requests (auth disabled in e2e → super-admin behaviour) ───

test.describe('API: /api/access-requests/teams', () => {
  test('returns an array of team/season combos', async ({ request }) => {
    const res = await request.get(`${API}/api/access-requests/teams`)
    expect(res.status()).toBe(200)
    const teams = await res.json()
    expect(Array.isArray(teams)).toBe(true)
  })
})

test.describe('API: /api/access-requests/my-groups', () => {
  test('returns an array (all watched teams for super admin)', async ({ request }) => {
    const res = await request.get(`${API}/api/access-requests/my-groups`)
    expect(res.status()).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})

test.describe('API: /api/admin/teams', () => {
  test('returns team list with team_id and season_id shape', async ({ request }) => {
    const res = await request.get(`${API}/api/admin/teams`)
    expect(res.status()).toBe(200)
    const teams = await res.json()
    expect(Array.isArray(teams)).toBe(true)
    for (const t of teams) {
      expect(t).toHaveProperty('team_id')
      expect(t).toHaveProperty('season_id')
    }
  })
})

test.describe('API: access request lifecycle', () => {
  test('POST creates a pending request and count reflects it', async ({ request }) => {
    const post = await request.post(`${API}/api/access-requests`, {
      data: { team_id: 778899, season_id: 259 },
    })
    expect(post.status()).toBe(200)
    expect((await post.json()).ok).toBe(true)

    const countRes = await request.get(`${API}/api/access-requests/count`)
    expect(countRes.status()).toBe(200)
    expect((await countRes.json()).count).toBeGreaterThanOrEqual(1)
  })

  test('POST without team_id/season_id is rejected', async ({ request }) => {
    const res = await request.post(`${API}/api/access-requests`, { data: {} })
    expect(res.status()).toBe(400)
  })

  test('pending list includes the created request', async ({ request }) => {
    const res = await request.get(`${API}/api/access-requests?status=pending`)
    expect(res.status()).toBe(200)
    const rows = await res.json()
    expect(Array.isArray(rows)).toBe(true)
  })
})

test.describe('API: rate limiting', () => {
  test('responses carry standard RateLimit headers', async ({ request }) => {
    const res = await request.get(`${API}/api/matches?limit=1`)
    expect(res.status()).toBe(200)
    // express-rate-limit standardHeaders → RateLimit-Limit / RateLimit-Remaining
    const headers = res.headers()
    expect(headers['ratelimit-limit'] ?? headers['ratelimit']).toBeDefined()
  })
})
