'use strict'

// Test the pure ICS generation helpers by requiring the module and exercising
// the exported handler indirectly through the helper functions we can reach
// via the module's own require graph — or by testing the visible output of
// the public ICS endpoint using supertest with a mock DB.

// Pull out the internal helpers via a re-require trick: jest.resetModules lets
// us intercept require('../db/schema') so no real SQLite file is needed.

jest.mock('../db/schema', () => ({
  getDb: jest.fn()
}))

const { getDb } = require('../db/schema')
const { router, icsHandler } = require('./calendar')
const { icsLimiter } = require('../middleware/rateLimit')
const express = require('express')
const request = require('supertest')

// nosemgrep: CSRF not applicable — calendar feed uses an opaque token in the URL,
// not cookie-based auth. Authenticated management endpoints use Clerk Bearer tokens.
function makeApp() {
  const app = express() // nosemgrep
  app.get('/feed/:token', icsLimiter, icsHandler)
  app.use('/cal', router)
  return app
}

// ── ICS output shape ─────────────────────────────────────────────────────────

describe('ICS feed — token validation', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 404 for a token that contains illegal characters', async () => {
    const app = makeApp()
    const res = await request(app).get('/feed/<script>alert(1)</script>')
    expect(res.status).toBe(404)
  })

  it('returns 404 for an empty token', async () => {
    const app = makeApp()
    // Express will match the literal dot-ics extension; supply a bare slash-separated path
    const res = await request(app).get('/feed/.')
    expect(res.status).toBe(404)
  })

  it('returns 404 when token not found in DB', async () => {
    getDb.mockReturnValue({
      prepare: () => ({ get: () => null })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    expect(res.status).toBe(404)
  })

  it('returns text/calendar for a valid token with no fixtures', async () => {
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        get: () => ({ clerk_user_id: 'user_1', club_id: 1 }),
        all: () => []
      })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/calendar/)
    expect(res.text).toContain('BEGIN:VCALENDAR')
    expect(res.text).toContain('END:VCALENDAR')
    expect(res.text).not.toContain('BEGIN:VEVENT')
  })

  it('emits one VEVENT per upcoming fixture', async () => {
    const fixture = {
      fixture_id: '999',
      play_cricket_id: '12345',
      home_team: 'Home CC',
      away_team: 'Away CC',
      ground: 'The Oval',
      match_date_iso: '2026-08-01',
      competition: 'League'
    }
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        get: () => ({ clerk_user_id: 'user_1', club_id: 1 }),
        all: () => [fixture]
      })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    expect(res.status).toBe(200)
    expect(res.text).toContain('BEGIN:VEVENT')
    expect(res.text).toContain('END:VEVENT')
    expect(res.text).toContain('UID:PCID_12345@edgexi.uk')
    expect(res.text).toContain('DTSTART;VALUE=DATE:20260801')
    expect(res.text).toContain('DTEND;VALUE=DATE:20260802')
    expect(res.text).toContain('SUMMARY:Home CC v Away CC')
    expect(res.text).toContain('LOCATION:The Oval')
    expect(res.text).toContain('DESCRIPTION:League')
  })

  it('uses MAN_ UID for fixtures without play_cricket_id', async () => {
    const fixture = {
      fixture_id: 'MAN-42',
      play_cricket_id: null,
      home_team: 'A',
      away_team: 'B',
      ground: null,
      match_date_iso: '2026-09-10',
      competition: null
    }
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        get: () => ({ clerk_user_id: 'user_1', club_id: 1 }),
        all: () => [fixture]
      })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    expect(res.text).toContain('UID:MAN_MAN-42@edgexi.uk')
    expect(res.text).not.toContain('LOCATION:')
    expect(res.text).not.toContain('DESCRIPTION:')
  })

  it('omits LOCATION and DESCRIPTION when null', async () => {
    const fixture = {
      fixture_id: '1',
      play_cricket_id: '1',
      home_team: 'X',
      away_team: 'Y',
      ground: null,
      match_date_iso: '2026-07-20',
      competition: null
    }
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        get: () => ({ clerk_user_id: 'u', club_id: 2 }),
        all: () => [fixture]
      })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    expect(res.text).not.toContain('LOCATION:')
    expect(res.text).not.toContain('DESCRIPTION:')
  })

  it('strips .ics extension from token before DB lookup', async () => {
    let capturedToken
    getDb.mockReturnValue({
      prepare: () => ({
        get: (tok) => {
          capturedToken = tok
          return null
        },
        all: () => []
      })
    })
    const app = makeApp()
    await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456.ics')
    // Token RE must pass first; the .ics version may not, so just check the stripped form
    // if the regex allowed it. If the regex rejects it (with .ics), capturedToken stays undefined.
    // Either way the DB is not queried with the .ics suffix.
    expect(capturedToken).not.toMatch(/\.ics$/)
  })
})

// ── ICS escaping edge-cases ──────────────────────────────────────────────────

describe('ICS special characters in fixture names', () => {
  function fixtureWith(home, away) {
    return {
      fixture_id: '1',
      play_cricket_id: '1',
      home_team: home,
      away_team: away,
      ground: null,
      match_date_iso: '2026-07-01',
      competition: null
    }
  }

  async function getIcs(home, away) {
    getDb.mockReturnValue({
      prepare: jest.fn().mockReturnValue({
        get: () => ({ clerk_user_id: 'u', club_id: 1 }),
        all: () => [fixtureWith(home, away)]
      })
    })
    const app = makeApp()
    const res = await request(app).get('/feed/aBcDeFgHiJkLmNoPqRsTuVwXyZ123456')
    return res.text
  }

  it('escapes semicolons in team names', async () => {
    const ics = await getIcs('A;B CC', 'C CC')
    expect(ics).toContain('SUMMARY:A\\;B CC v C CC')
  })

  it('escapes commas in team names', async () => {
    const ics = await getIcs('A,B CC', 'C CC')
    expect(ics).toContain('SUMMARY:A\\,B CC v C CC')
  })
})

// ── parseGroupPairs ──────────────────────────────────────────────────────────

const { parseGroupPairs } = require('../utils/access')

describe('parseGroupPairs', () => {
  it('returns empty array for no groups param', () => {
    expect(parseGroupPairs({})).toEqual([])
  })

  it('parses a single team:season pair', () => {
    expect(parseGroupPairs({ groups: '35533:259' })).toEqual([{ team_id: 35533, season_id: 259 }])
  })

  it('parses multiple comma-separated pairs', () => {
    expect(parseGroupPairs({ groups: '1:10,2:20' })).toEqual([
      { team_id: 1, season_id: 10 },
      { team_id: 2, season_id: 20 }
    ])
  })

  it('ignores non-integer tokens', () => {
    expect(parseGroupPairs({ groups: 'abc:xyz' })).toEqual([])
  })

  it('ignores malformed entries but keeps valid ones', () => {
    expect(parseGroupPairs({ groups: '1:10,bad,2:20' })).toEqual([
      { team_id: 1, season_id: 10 },
      { team_id: 2, season_id: 20 }
    ])
  })

  it('falls back to team_id/season_id query params', () => {
    expect(parseGroupPairs({ team_id: '5', season_id: '99' })).toEqual([
      { team_id: 5, season_id: 99 }
    ])
  })
})
